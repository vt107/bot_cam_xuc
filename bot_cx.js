const puppeteer = require('puppeteer-extra');
const fs = require('fs');
const cheerio = require('cheerio');

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
    }

    async init() {
        let args = ['--disable-setuid-sandbox', '--no-sandbox'];

        this.browser = await puppeteer.launch({
            args,
            // headless: false,
            headless: 'shell',
        });

        this.fbPage = await this.browser.newPage();

        await this.fbPage.setViewport({
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
        });

        // Configure the navigation timeout
        await this.fbPage.setDefaultNavigationTimeout(0);

        console.log('Đang đăng nhập');
        await this.fbPage.setCookie(...cookieStringToObj(this.cookie));

        await this.fbPage.setUserAgent(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
        );

        await this.fbPage.setExtraHTTPHeaders({
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.131 Safari/537.36',
            'upgrade-insecure-requests': '1',
            'viewport-width': '390'
        })

        // let newCookie = '';
        // this.fbPage.on('response', async (response) => {
        //     let networkUrl = response.url();
        //     let headers = response.headers();
        //
        //     if (networkUrl.includes('facebook.com') && headers && headers['set-cookie']) {
        //         let setCookie = headers['set-cookie'];
        //         if (typeof setCookie === "string") setCookie = [setCookie];
        //         // Try to get new cookie from current cookie or account cookie
        //         newCookie = getCookie(newCookie || this.cookie, setCookie);
        //         console.log({newCookie})
        //     }
        // });

        this.fbPage.on('error', () => {
            // console.error('fetchData error', error);
        })

        this.fbPage.on('pageerror', () => {
            // console.error('fetchData pageerror', error);
        })

        // console.log('opening facebook');
        await this.fbPage.goto('https://m.facebook.com/', { waitUntil: 'networkidle0' });
    }

    scroll(amount) {
        // console.log('scroll ', amount);
        this.fbPage.evaluate(amount => {
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

        let likeButtons = [];
        const selector = '[data-long-click-action-id][data-comp-id]';
        posts.forEach(string => {
            const $ = cheerio.load(string);

            if (!$('[data-long-click-action-id]').length) return;
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
            this.stop = true;
            await this.fbPage.close();
            await this.browser.close();
            setTimeout(() => {
                this.start();
            }, random(10000, 20000));
            return;
        } else {
            console.log(`Thấy ${likeButtons.length} nút like`);
        }

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
                // console.error('Like lỗi', likeTarget, e.message);
            }
        }
    }

    async start() {
        this.stop = false;
        await this.init();

        console.log('Đang khởi động')
        await wait(1, 10);

        // Check current task
        this.taskInterval = setInterval(() => {
            if (this.stop) {
                if (this.taskInterval) clearInterval(this.taskInterval);
                return;
            }

            let { tasks } = this;
            if (tasks.length === 0) {
                // console.log('tasks empty, pushing new...')

                for (let i = 0; i <= random(3, 7); i++) {
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

                // console.log('pushed task: ', tasks.length);
            }
        }, 3000);

        this.handleTask().then();
    }

    async handleTask() {
        // console.log('Thực thi lượt mới');

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

let cookieFile = 'cookie.txt';
if (!fs.existsSync(cookieFile)) {
    console.error(`Cookie file ${cookieFile} not exist`);
    process.exit(0);
}

let cookie = fs.readFileSync(cookieFile, 'utf-8');
// cookie = cookie.replace(/(\r\n|\n|\r)/gm, "");
let job = new fbJob(cookie);
job.start().then(() => {
    // console.log('started')
})



