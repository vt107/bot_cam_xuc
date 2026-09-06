/**
 * get_friends.js — quét danh sách bạn bè, lưu vào friends.json
 *
 *   node get_friends.js              quét bình thường
 *   node get_friends.js --debug      + lưu debug_friends.html và in mẫu href
 *   node get_friends.js --show       hiện cửa sổ trình duyệt để nhìn tận mắt
 *   node get_friends.js --force      ghi đè cả file đã đánh dấu "manual": true
 *   node get_friends.js --from-html <file>
 *                                    bỏ qua trình duyệt, đọc thẳng file HTML trang bạn bè
 *                                    đã lưu tay (Ctrl+S / copy outerHTML). Dùng được cả
 *                                    HTML của www.facebook.com lẫn m.facebook.com.
 *
 * Chạy riêng, không đụng tới bot. Sửa/chạy lại thoải mái cho tới khi ra đúng danh sách.
 */
const fs = require('fs');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');

// require bot_cx.js chỉ để lấy helper — nhờ `require.main` nên bot KHÔNG tự chạy
const { config, iPhone12, profileKey, cookieStringToObj, readCookie, wait } = require('./bot_cx.js');

const DEBUG = process.argv.includes('--debug');
const SHOW = process.argv.includes('--show');
const FORCE = process.argv.includes('--force');

const fromHtmlIdx = process.argv.indexOf('--from-html');
const FROM_HTML = fromHtmlIdx !== -1 ? process.argv[fromHtmlIdx + 1] : null;

// Thử lần lượt tới khi có kết quả. URL đầu là giao diện bạn bè hiện tại của m.facebook.com.
const FRIEND_URLS = [
    'https://m.facebook.com/friends/?target_pivot_link=friends',
    'https://m.facebook.com/friends/list/',
    'https://m.facebook.com/friends/center/friends/',
    'https://m.facebook.com/me/friends',
];

// Dưới ngưỡng này coi như quét hụt, thử URL kế tiếp
const MIN_EXPECTED = 5;

const NEXT_LABELS = ['xem thêm', 'see more', 'xem tất cả', 'see all', 'tải thêm', 'load more'];

/** Cuộn + bấm "Xem thêm" tới khi số link ngừng tăng */
const expandList = async page => {
    let prev = -1;
    let stable = 0;

    for (let i = 0; i < 80; i++) {
        await page.evaluate(labels => {
            const nodes = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
            for (const n of nodes) {
                const t = (n.innerText || '').trim().toLowerCase();
                if (labels.includes(t)) { n.click(); return; }
            }
        }, NEXT_LABELS);

        await page.evaluate(() => window.scrollBy(0, 3000));
        await wait(1200, 2200, true);

        const count = await page.evaluate(() => document.querySelectorAll('a[href]').length);

        if (count === prev) {
            if (++stable >= 3) break;
        } else {
            stable = 0;
        }
        prev = count;

        if (i % 10 === 0) console.log(`   ...cuộn lượt ${i}, ${count} link`);
    }

    return prev;
};

/** In chẩn đoán để biết vì sao không rút được profile nào */
const diagnose = links => {
    const paths = {};
    const rejected = [];

    for (const { href } of links) {
        let p = href;
        try {
            p = new URL(href, 'https://m.facebook.com').pathname;
        } catch (e) { /* href rác, giữ nguyên */ }

        paths[p] = (paths[p] || 0) + 1;
        if (!profileKey(href) && rejected.length < 25) rejected.push(href);
    }

    const top = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 25);

    console.log('\n--- CHẨN ĐOÁN ---');
    console.log(`Tổng a[href]: ${links.length}`);
    console.log('\n25 pathname nhiều nhất:');
    for (const [p, n] of top) console.log(`   ${String(n).padStart(4)}  ${p}`);
    console.log('\n25 href bị profileKey loại:');
    for (const h of rejected) console.log(`   ${h.slice(0, 120)}`);
    console.log('--- HẾT CHẨN ĐOÁN ---\n');
};

/** Gom {href, text} -> {ids, names}, giữ tên đầu tiên trông giống tên người cho mỗi profile */
const collect = links => {
    const byKey = new Map();

    for (const { href, text } of links) {
        const key = profileKey(href);
        if (!key) continue;

        const name = (text || '').trim();
        const usable = name.length > 1 && name.length < 60 ? name : '';

        if (!byKey.has(key)) byKey.set(key, usable);
        else if (!byKey.get(key) && usable) byKey.set(key, usable);
    }

    return {
        ids: [...byKey.keys()],
        names: [...byKey.values()].filter(Boolean),
    };
};

/** Đọc danh sách từ file HTML lưu tay, không cần mở trình duyệt */
const parseHtmlFile = file => {
    if (!fs.existsSync(file)) {
        console.error(`Không thấy file ${file}`);
        process.exit(1);
    }

    console.log(`Đọc ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);

    const $ = cheerio.load(fs.readFileSync(file, 'utf-8'));
    const links = $('a[href]').map((i, el) => ({
        href: $(el).attr('href'),
        text: $(el).text().trim(),
    })).get();

    const result = collect(links);
    console.log(`   ${links.length} link -> ${result.ids.length} profile duy nhất, ${result.names.length} có kèm tên`);

    if (DEBUG) diagnose(links);

    return result;
};

const scrapeFrom = async (page, url) => {
    console.log(`\nThử ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    console.log(`   URL sau chuyển hướng: ${page.url()}`);

    await expandList(page);

    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => ({
            href: a.getAttribute('href') || '',
            text: (a.innerText || '').trim(),
        })));

    const result = collect(links);
    console.log(`   -> ${links.length} link, rút được ${result.ids.length} profile`);

    if (DEBUG || result.ids.length < MIN_EXPECTED) {
        diagnose(links);
        fs.writeFileSync('debug_friends.html', await page.content());
        console.log('Đã lưu debug_friends.html');
    }

    return result;
};

/** Ghi friends.json, tôn trọng cờ "manual": true */
const save = result => {
    if (!FORCE && fs.existsSync(config.friendsFile)) {
        try {
            const existing = JSON.parse(fs.readFileSync(config.friendsFile, 'utf-8'));
            if (existing.manual === true) {
                console.error('');
                console.error(`${config.friendsFile} đang có "manual": true — đã sửa tay, không ghi đè.`);
                console.error(`Lấy được ${result.ids.length} profile nhưng KHÔNG lưu.`);
                console.error('Muốn ghi đè thì chạy lại với --force.');
                process.exitCode = 1;
                return false;
            }
        } catch (e) {
            console.warn(`Không đọc được ${config.friendsFile} để kiểm tra, sẽ ghi đè:`, e.message);
        }
    }

    fs.writeFileSync(
        config.friendsFile,
        JSON.stringify({ at: Date.now(), ids: result.ids, names: result.names }, null, 2)
    );

    console.log(`\nĐã lưu ${result.ids.length} profile vào ${config.friendsFile}`);
    console.log('');
    console.log('!! MỞ FILE KIỂM TRA trước khi chạy bot: trang bạn bè có thể lẫn mục');
    console.log('!! "Những người bạn có thể biết" hoặc link điều hướng. Nếu số lượng lệch nhiều');
    console.log('!! so với số bạn bè thật, hãy xoá bớt rồi thêm "manual": true vào file —');
    console.log('!! bot sẽ dùng vĩnh viễn và lần chạy sau sẽ từ chối ghi đè (trừ khi --force).');
    return true;
};

(async () => {
    // Nguồn HTML lưu tay: không cần trình duyệt, không cần cookie
    if (FROM_HTML) {
        save(parseHtmlFile(FROM_HTML));
        return;
    }

    const browser = await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
        ],
        headless: SHOW ? false : 'shell',
    });

    try {
        const page = await browser.newPage();
        await page.emulate(iPhone12);
        await page.setDefaultNavigationTimeout(0);
        await page.setCookie(...cookieStringToObj(readCookie()));

        let result = { ids: [], names: [] };

        for (const url of FRIEND_URLS) {
            try {
                result = await scrapeFrom(page, url);
                if (result.ids.length >= MIN_EXPECTED) break;
                console.log('   quá ít kết quả, thử URL kế tiếp');
            } catch (e) {
                console.error(`   lỗi: ${e.message}`);
            }
        }

        if (!result.ids.length) {
            console.error('\nKhông rút được profile nào từ bất kỳ URL nào.');
            console.error('Gửi debug_friends.html + phần CHẨN ĐOÁN ở trên để dò lại selector,');
            console.error(`hoặc tạo tay ${config.friendsFile} theo hướng dẫn trong README.`);
            process.exitCode = 1;
            return;
        }

        save(result);
    } finally {
        await browser.close();
    }
})();
