const puppeteer = require('puppeteer-extra');
const fs = require('fs');
const cheerio = require('cheerio');

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ============================================================================
// Cấu hình
// ============================================================================
const config = Object.freeze({
    // Chỉ like bài của bạn bè. Đặt false để quay lại hành vi cũ (like mọi bài trên feed).
    friendsOnly: true,

    // Log tác giả từng bài kèm kết quả so khớp. Bật khi mới cài để kiểm chứng bộ lọc,
    // chạy ổn rồi thì tắt cho log gọn.
    verifyMode: true,

    // Nơi lưu danh sách bạn bè. Xem README mục "Danh sách bạn bè".
    friendsFile: 'friends.json',

    // Cache quá số ngày này thì quét lại (bỏ qua nếu file có "manual": true).
    friendsCacheDays: 7,

    // Số lượt quét liên tiếp không thấy bài bạn bè nào trước khi dựng lại cả phiên duyệt.
    maxEmptyScans: 8,

    // Ghi HTML thô ra debug_post.html / debug_friends.html để dò selector khi lọc sai.
    dumpDebugHtml: false,
});

const iPhone12 = {
    name: 'iPhone 12',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        isLandscape: false,
    },
};

// ============================================================================
// Helpers
// ============================================================================
const cookieStringToObj = cookie => {
    cookie = cookie.split('; ');

    const result = [];
    for (let string of cookie) {
        const cur = string.split('=');
        result.push({
            name: cur[0],
            value: cur[1],
            domain: 'm.facebook.com'
        });
    }

    return result;
}

const random = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const wait = (time, maxTime = false, ms = false) => {
    if (maxTime !== false) time = random(time, maxTime);

    return new Promise(resolve => {
        setTimeout(function () {
            return resolve();
        }, time * (ms ? 1 : 1000));
    });
};

// Các segment đầu đường dẫn KHÔNG trỏ tới profile cá nhân.
const NON_PROFILE_PATHS = new Set([
    'groups', 'watch', 'reel', 'reels', 'marketplace', 'events', 'pages', 'gaming',
    'hashtag', 'photo.php', 'story.php', 'permalink.php', 'video.php', 'photo',
    'stories', 'settings', 'privacy', 'help', 'friends', 'search', 'notifications',
    'messages', 'bookmarks', 'ads', 'login.php', 'home.php', 'a', 'l.php',
]);

/**
 * Rút khoá định danh profile từ href.
 * Trả về id số (/profile.php?id=123) hoặc username (/nguyen.van.a), null nếu không phải profile.
 */
const profileKey = href => {
    if (!href) return null;

    try {
        const u = new URL(href, 'https://m.facebook.com');
        if (!/(^|\.)facebook\.com$/.test(u.hostname)) return null;

        if (u.pathname === '/profile.php') {
            const id = u.searchParams.get('id');
            return id ? id.toLowerCase() : null;
        }

        const segments = u.pathname.split('/').filter(Boolean);
        if (segments.length !== 1) return null;

        const first = segments[0].toLowerCase();
        if (NON_PROFILE_PATHS.has(first)) return null;
        if (first.includes('.php')) return null;

        return first;
    } catch (e) {
        return null;
    }
};

const normalizeName = name => {
    if (!name) return '';
    return name.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
};

const taskTypes = Object.freeze({
    SCROLL: 'scroll',
    LIKE: 'like',
    WAIT: 'wait'
})

class fbJob {
    constructor(cookie) {
        // Save temporary cookie
        this.cookie = cookie;

        this.browser = null;
        this.fbPage = null;

        this.tasks = [];
        this.total = 0;
        this.slowNetwork = false;
        this.stop = false;
        this.taskInterval = null;

        // Danh sách bạn bè để đối chiếu tác giả bài viết
        this.friends = { ids: new Set(), names: new Set() };
        // Số lượt quét liên tiếp không tìm được bài nào của bạn bè
        this.emptyScans = 0;
    }

    async init() {
        let args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
        ];

        this.browser = await puppeteer.launch({
            args,
                        headless: 'shell',
            headless: false,
            devtools: true
        });

        this.fbPage = await this.browser.newPage();

        await this.fbPage.emulate(iPhone12);

        await this.fbPage.setViewport({
            width: 400,
            height: 751,
            deviceScaleFactor: 1,
        });

        // Configure the navigation timeout
        await this.fbPage.setDefaultNavigationTimeout(0);

        console.log('Đang đăng nhập');
        await this.fbPage.setCookie(...cookieStringToObj(this.cookie));

        this.fbPage.on('error', () => {
            // console.error('fetchData error', error);
        })

        this.fbPage.on('pageerror', () => {
            // console.error('fetchData pageerror', error);
        });

        console.log('opening facebook');
        await this.fbPage.goto('https://m.facebook.com/', { waitUntil: 'networkidle0' });

        if (config.friendsOnly) {
            this.friends = await this.loadFriends();

            if (!this.friends.ids.size && !this.friends.names.size) {
                console.error('');
                console.error('Danh sách bạn bè rỗng — bật friendsOnly thì bot sẽ không like được bài nào.');
                console.error(`Cách xử lý: tạo tay ${config.friendsFile} (xem README), hoặc đặt config.friendsOnly = false.`);
                process.exit(1);
            }

            console.log(`Lọc bạn bè: ${this.friends.ids.size} id, ${this.friends.names.size} tên`);
        }
    }

    // ------------------------------------------------------------------------
    // Danh sách bạn bè
    // ------------------------------------------------------------------------

    toFriendSet(ids = [], names = []) {
        return {
            ids: new Set(ids.filter(Boolean).map(v => String(v).toLowerCase())),
            names: new Set(names.filter(Boolean).map(normalizeName).filter(Boolean)),
        };
    }

    /**
     * Nạp danh sách bạn bè theo thứ tự ưu tiên:
     *   1. file có "manual": true  -> dùng luôn, không bao giờ quét lại
     *   2. file xuất từ Facebook DYI ("friends_v2") -> khớp theo tên
     *   3. cache còn hạn -> dùng lại
     *   4. không có gì -> báo lỗi, người dùng chạy `npm run friends`
     */
    async loadFriends() {
        const { friendsFile, friendsCacheDays } = config;

        if (fs.existsSync(friendsFile)) {
            try {
                const cache = JSON.parse(fs.readFileSync(friendsFile, 'utf-8'));

                // Định dạng xuất từ Facebook "Download Your Information"
                if (Array.isArray(cache.friends_v2)) {
                    const names = cache.friends_v2.map(f => f && f.name).filter(Boolean);
                    console.log(`Dùng ${friendsFile} (Facebook DYI): ${names.length} tên`);
                    return this.toFriendSet([], names);
                }

                const ids = cache.ids || [];
                const names = cache.names || [];

                if (cache.manual === true) {
                    console.log(`Dùng ${friendsFile} (thủ công): ${ids.length} id, ${names.length} tên`);
                    return this.toFriendSet(ids, names);
                }

                const ageDays = cache.at ? (Date.now() - cache.at) / 86400000 : Infinity;
                if (ageDays < friendsCacheDays) {
                    console.log(`Dùng cache bạn bè: ${ids.length} id (${ageDays.toFixed(1)} ngày tuổi)`);
                    return this.toFriendSet(ids, names);
                }

                console.log(`Cache bạn bè quá ${friendsCacheDays} ngày, quét lại...`);
            } catch (e) {
                console.error(`Không đọc được ${friendsFile}:`, e.message);
            }
        }

        console.error('');
        console.error(`Chưa có ${friendsFile} (hoặc cache đã quá hạn).`);
        console.error('Chạy `npm run friends` để quét danh sách bạn bè trước.');
        return this.toFriendSet([], []);
    }

    // ------------------------------------------------------------------------
    // Nhận diện tác giả bài viết
    // ------------------------------------------------------------------------

    /**
     * Link profile đầu tiên theo thứ tự DOM trong một bài viết gần như luôn là
     * tác giả ở header — không phụ thuộc class name nên ít vỡ khi FB đổi markup.
     */
    getPostAuthor($) {
        const links = $('a[href]');

        for (let i = 0; i < links.length; i++) {
            const el = links.eq(i);
            const key = profileKey(el.attr('href'));
            if (key) return { key, name: el.text().trim() };
        }

        return null;
    }

    isFriend(author) {
        if (!author) return false;
        if (this.friends.ids.has(author.key)) return true;

        const name = normalizeName(author.name);
        return !!name && this.friends.names.has(name);
    }

    // ------------------------------------------------------------------------
    // Tác vụ
    // ------------------------------------------------------------------------

    async scroll(amount) {
        // console.log('scroll ', amount);
        await this.fbPage.evaluate(amount => {
            window.scrollBy(0, amount);
        }, amount);
    }

    async findPostAndLike() {
        let posts = await this.fbPage.evaluate((sel) => {
            let elements = Array.from(document.querySelectorAll(sel));
            return elements.map(element => {
                return element.outerHTML
            });
        }, 'div[data-tracking-duration-id][data-tti-phase][data-mcomponent="MContainer"]');

        posts = posts.filter(item => !item.match(/Suggested for you|Sponsored|tài trợ/));

        if (config.dumpDebugHtml && posts.length) {
            fs.writeFileSync('debug_post.html', posts.slice(0, 3).join('\n\n<!-- ===== POST ===== -->\n\n'));
            console.log('Đã lưu debug_post.html');
        }

        let likeButtons = [];
        const selector = '[data-long-click-action-id][data-comp-id]';
        posts.forEach(string => {
            const $ = cheerio.load(string);

            if (!$(selector).length) return;

            if (config.friendsOnly) {
                const author = this.getPostAuthor($);
                const ok = this.isFriend(author);

                if (config.verifyMode) {
                    const who = author
                        ? `${author.key}${author.name ? ` (${author.name})` : ''}`
                        : 'không xác định';
                    console.log(`  tác giả: ${who} ${ok ? '✓ bạn bè' : '✗ bỏ qua'}`);
                }

                if (!ok) return;
            }

            const text = $('div.bg-s3:nth-child(2) .native-text').text().split('See more')[0];
            const liked = $(`${selector}`).find('button.native-text span:first-child').attr('style') == 'color:#0d83ff;';
            if (liked) return;

            const id = $(selector).attr('data-long-click-action-id');
            if (text && text.match(/Xem bản dịch|Được dịch từ Tiếng/)) {
                // console.log('filter foreign post', text);
                return;
            }

            likeButtons.push({
                text,
                selector: `[data-long-click-action-id="${id}"]`
            })
        });

        if (!likeButtons.length) {
            this.emptyScans++;

            // Với bộ lọc bạn bè, phần lớn lượt quét sẽ không có bài hợp lệ.
            // Cuộn thêm lấy bài mới thay vì dựng lại cả phiên duyệt.
            if (this.emptyScans < config.maxEmptyScans) {
                console.log(`Chưa thấy bài của bạn bè (${this.emptyScans}/${config.maxEmptyScans}), cuộn tiếp`);
                await this.scroll(random(600, 1200));
                return;
            }

            console.log('Hết bài để like, khởi động lại phiên duyệt');
            this.emptyScans = 0;
            this.stop = true;
            await this.fbPage.close();
            await this.browser.close();
            setTimeout(() => {
                this.start();
            }, random(5_000, 15_000));
            return;
        }

        this.emptyScans = 0;
        console.log(`Thấy ${likeButtons.length} nút like`);

        let liked = false;
        while(!liked && likeButtons.length) {
            const randomIndex = random(0, likeButtons.length - 1);
            let likeTarget = likeButtons[randomIndex];

            likeButtons.splice(randomIndex, 1);

            const element = await this.fbPage.$(likeTarget.selector);

            try {
                if (element) {
                    await element.scrollIntoView();
                    await element.click();
                    console.log(`Đã like ${likeTarget.text}`);
                    this.total++;
                    console.log('Tổng đã like: ', this.total);

                    liked = true;
                    break;
                }
            } catch (e) {
                console.error('Like lỗi', likeTarget, e.message);
            }
        }
    }

    async start() {
        this.stop = false;
        await this.init();

        console.log('Đang khởi động')
        await wait(1, 5);

        // Check current task
        this.taskInterval = setInterval(() => {
            if (this.stop) {
                if (this.taskInterval) clearInterval(this.taskInterval);
                return;
            }

            let { tasks } = this;
            if (tasks.length === 0) {
                // console.log('tasks empty, pushing new...')

                for (let i = 0; i <= random(2, 5); i++) {
                    tasks.push({
                        type: taskTypes.SCROLL,
                        amount: random(-300, 400)
                    })
                }

                tasks.push({
                    type: taskTypes.LIKE
                });

                let randomValue = random(10, 1000);
                if (randomValue % 13 == 0) {
                    let delay = random(60, 2 * 60);
                    // console.log('insert big delay', delay);
                    tasks.push({
                        type: taskTypes.WAIT,
                        value: delay
                    });
                }

                console.log('pushed task: ', tasks.length);
            }
        }, 3000);

        this.handleTask().then();
    }

    async handleTask() {
        console.log('Thực thi lượt mới');

        let { tasks } = this;
        if (this.stop) return;

        if (tasks.length) {
            await this.checkSlowNetwork();

            let task = tasks[0];
            tasks.splice(0, 1);

            switch (task.type) {
                case taskTypes.SCROLL:
                    await this.scroll(task.amount);
                    break;
                case taskTypes.LIKE:
                    await this.findPostAndLike();
                    break;
                case taskTypes.WAIT:
                    console.log(`chờ ${task.value}s và tải lại`);
                    await wait(task.value);
                    this.fbPage.reload();
                    await wait(5);
                    break;
            }
        }

        // Delay each task
        await wait(1000, 10000, true);

        this.handleTask().then();
    }

    async checkSlowNetwork() {
        if (this.slowNetwork) return;
        const linkSlowNetwork = await this.fbPage.$(`#load-time-out-banner a`);

        if (linkSlowNetwork) {
            // console.log('Slow network detected');
            this.slowNetwork = true;
            linkSlowNetwork.click();
            await wait(5);
        }
    }
}

const readCookie = (cookieFile = 'cookie.txt') => {
    if (!fs.existsSync(cookieFile)) {
        console.error(`Cookie file ${cookieFile} not exist`);
        process.exit(1);
    }
    // return fs.readFileSync(cookieFile, 'utf-8').replace(/(\r\n|\n|\r)/gm, "");
    return fs.readFileSync(cookieFile, 'utf-8');
};

// Chỉ tự chạy khi gọi trực tiếp `node bot_cx.js`.
// Khi được require (vd. get_friends.js) thì chỉ export helper, không khởi động bot.
if (require.main === module) {
    const job = new fbJob(readCookie());
    job.start().then(() => {
        // console.log('started')
    });
}

module.exports = {
    fbJob,
    config,
    iPhone12,
    profileKey,
    normalizeName,
    cookieStringToObj,
    readCookie,
    wait,
    random,
};
