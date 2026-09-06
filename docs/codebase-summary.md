# Codebase Summary

> Source of truth for "what's actually in this repo." For requirements/rationale see
> [`project-overview-pdr.md`](./project-overview-pdr.md); for runtime design see
> [`system-architecture.md`](./system-architecture.md); for conventions see
> [`code-standards.md`](./code-standards.md).

Last verified against source: 2026-08-22 — `bot_cx.js` at 524 lines (was 565; scraping
was extracted out), `get_friends.js` at 249 lines (was 198; gained a `--from-html <file>`
offline-parse mode, plus the shared `collect`/`save` helpers that mode required). Working-
tree changes on top of commit `ca13193` (not yet committed at time of writing).

## File map

The application is now **two** scripts plus a handful of config/data files: the bot
itself, and a standalone friend-list scraper it no longer runs on its own. There is no
`src/` tree, no build step, no tests, and no CI.

| Path | Role |
|---|---|
| `bot_cx.js` | The bot: browser setup, cookie auth, friends-only filtering, task queue, scroll/like logic. ~524 lines. No longer scrapes anything itself — see [Friends list file](#friends-list-file-friendsjson) below. Also the shared helper module: exports `fbJob`, `config`, `iPhone12`, `profileKey`, `normalizeName`, `cookieStringToObj`, `readCookie`, `wait`, `random` for `get_friends.js` to reuse. |
| `get_friends.js` | Standalone, re-runnable friend-list acquisition script — two independent ways to fill `friends.json`: a live browser scrape, or `--from-html <file>` parsing of a hand-saved friends-page HTML file (no browser, no cookie). Run via `npm run friends` or `node get_friends.js`. Requires `bot_cx.js` for shared helpers (safe — see [module boundary](./code-standards.md#module-boundary-convention)). ~249 lines. See [get_friends.js function table](#functions-get_friendsjs) below. |
| `package.json` | Project manifest. Name `fb_bot`, v1.0.0. `npm start` → `node bot_cx.js`. `npm run friends` → `node get_friends.js`. `npm test` is a stub that exits 1. `"main": "index.js"` is a dead field — no `index.js` exists and nothing requires the package as a module. |
| `ecosystem.config.js` | PM2 process definition — see [system-architecture.md](./system-architecture.md#pm2) for how it's used. |
| `cookie.txt` | **Not in git.** The Facebook session cookie string, read at startup by both `bot_cx.js` and `get_friends.js` via the shared `readCookie()` helper. Local secret. |
| `cookie.txt.example` | Empty placeholder committed to git so the expected file name is discoverable. |
| `friends.json` | **Not in git** (personal data). The friend list used for filtering — written by `get_friends.js`, read by `bot_cx.js`'s `loadFriends()`. See [Friends list file](#friends-list-file-friendsjson) below. |
| `debug_post.html` / `debug_friends.html` | **Not in git.** Optional raw-HTML dumps for selector debugging. `debug_post.html` is written by `bot_cx.js` only when `config.dumpDebugHtml` is `true`; `debug_friends.html` is written by `get_friends.js`'s live-scrape path automatically whenever a scrape falls short (or always, with `--debug`). See [DOM selectors](#dom-selectors-the-bot-depends-on). |
| `friend.txt` / `*.friends.html` | **Not in git**, not written by any script — these names are reserved for a hand-saved friends-page HTML file the operator drops in the repo to feed `get_friends.js --from-html <file>`. Personal data (a real friends page), same reasoning as `friends.json`. See [get_friends.js function table](#functions-get_friendsjs) below and [README.md](../README.md#danh-sách-bạn-bè). |
| `.gitignore` | Ignores `cookie.txt`, `friends.json`, `debug_post.html`, `debug_friends.html`, `friend.txt`, `*.friends.html`, `package-lock.json`, `node_modules`, `.idea`. Also has `!docs/` to override a `docs/` rule in the user's `~/.gitignore_global`, so this directory can still be committed. |
| `README.md` | Vietnamese quick-start (setup, run, friends list, requirements). |
| `docs/` | This directory. |

No `index.js`, no `src/`, no `lib/`, no `test/` directory exist in the repo.

## Dependencies (`package.json`)

| Package | Version | Purpose |
|---|---|---|
| `puppeteer` | `^23.8.0` | Drives headless Chromium. |
| `puppeteer-extra` | `*` (unpinned) | Wrapper that enables plugins on top of `puppeteer`. |
| `puppeteer-extra-plugin-stealth` | `*` (unpinned) | Patches common headless-browser fingerprints to reduce bot detection. |
| `cheerio` | `*` (unpinned) | Server-side jQuery-like HTML parser. In `bot_cx.js`, inspects post markup captured from the page and walks author links in `getPostAuthor`. **Also now used by `get_friends.js`** (`get_friends.js:16`), added specifically to parse a hand-saved friends-page HTML file in `parseHtmlFile()` — the live-scrape path still walks `a[href]` directly via `page.evaluate` instead, so `get_friends.js` only touches `cheerio` on the `--from-html` path. |

Three of four dependencies are unpinned (`*`), so `npm install` can pull a different
minor/major version on every fresh install — see the tracking item in
[project-overview-pdr.md](./project-overview-pdr.md#known-gaps--roadmap).
`package-lock.json` exists on disk but is git-ignored, so it cannot pin versions across
machines either.

## Config block (`bot_cx.js:11-30`)

The friends-only feature introduced the project's first centralized config block — a
single frozen object at the top of the file. Previously every tunable was a magic number
inline in a method; new tunables should be added here rather than scattered again (see
[code-standards.md](./code-standards.md#config-block-convention)).

| Field | Default | Meaning |
|---|---|---|
| `friendsOnly` | `true` | Only like posts whose author is a matched friend. `false` restores the old behavior (like everything not sponsored/foreign/already-liked). |
| `verifyMode` | `true` | Logs every scanned post's detected author and whether it matched, so the operator can verify author extraction/matching works before trusting it unattended. |
| `friendsFile` | `'friends.json'` | Path to the friend-list file, both read and written. |
| `friendsCacheDays` | `7` | Age in days after which a scraped (non-`manual`) `friends.json` is considered stale and re-scraped. |
| `maxEmptyScans` | `8` | Consecutive `LIKE` scans that find zero candidates before the bot tears down and restarts the whole browser session. |
| `dumpDebugHtml` | `false` | When `true`, writes `debug_post.html` (sample of scanned post HTML) and `debug_friends.html` (friends-center page HTML) to disk for selector spelunking. |

## Other module-level constants

| Symbol | Location | What it does |
|---|---|---|
| `iPhone12` | `bot_cx.js:32-43` | The iPhone 12 device-emulation profile (user agent + viewport). Was previously inlined inside `init()`; hoisted to module scope and now exported (`module.exports`, `bot_cx.js:514-524`) so the standalone `get_friends.js` can reuse the exact same profile for its own page instead of duplicating it. |
| `NON_PROFILE_PATHS` | `bot_cx.js:79-84` | A `Set` of first-path-segments that are **not** personal profiles on `facebook.com` — `groups`, `watch`, `reel`, `reels`, `marketplace`, `events`, `pages`, `gaming`, `hashtag`, `photo.php`, `story.php`, `permalink.php`, `video.php`, `photo`, `stories`, `settings`, `privacy`, `help`, `friends`, `search`, `notifications`, `messages`, `bookmarks`, `ads`, `login.php`, `home.php`, `a`, `l.php`. Used by `profileKey` to reject links that look like a profile URL but aren't. |

## Functions and methods (`bot_cx.js`)

| Symbol | Location | What it does |
|---|---|---|
| `cookieStringToObj(cookie)` | `bot_cx.js:48-62` | Splits a `name=value; name=value` cookie string into an array of Puppeteer cookie objects scoped to `domain: 'm.facebook.com'`. **Fragile**: splits each pair on `=` and keeps only `cur[0]`/`cur[1]`, so a cookie value that itself contains `=` (common in base64-padded values) is silently truncated. Exported for reuse by `get_friends.js`. |
| `random(min, max)` | `bot_cx.js:64-66` | Inclusive random integer in `[min, max]`. Exported for reuse by `get_friends.js`. |
| `wait(time, maxTime=false, ms=false)` | `bot_cx.js:68-76` | Promise-based sleep. If `maxTime` is given, the actual delay is `random(time, maxTime)`. Unit is **seconds** unless `ms` is `true`. Exported; `get_friends.js` uses it for its post-scroll settle delay. |
| `profileKey(href)` | `bot_cx.js:90-113` | Extracts a stable identity from a link: the numeric id from `/profile.php?id=N`, or the single-segment username path (e.g. `/nguyen.van.a`). Returns `null` for non-`facebook.com` hosts, multi-segment paths, `.php` paths, and anything in `NON_PROFILE_PATHS`. This is the core mechanism behind friends-only filtering — see [code-standards.md](./code-standards.md#match-by-stable-id-not-display-name). Exported; `get_friends.js` uses the exact same function both to extract profiles and, in `diagnose()`, to explain rejections. |
| `normalizeName(name)` | `bot_cx.js:115-118` | NFC-normalizes, trims, lowercases, and collapses whitespace in a display name. Used only for the weaker DYI name-matching path (see [Friends list file](#friends-list-file-friendsjson)). Exported. |
| `taskTypes` | `bot_cx.js:120-124` | `Object.freeze({ SCROLL: 'scroll', LIKE: 'like', WAIT: 'wait' })` — the task-queue enum. |
| `class fbJob` | `bot_cx.js:126` | The bot's only class; owns all mutable state (see below). Exported. |
| `fbJob.constructor(cookie)` | `bot_cx.js:127-144` | Stores the raw cookie string; initializes `browser`, `fbPage` to `null`, `tasks` to `[]`, `total` to `0`, `slowNetwork`/`stop` to `false`, `taskInterval` to `null`, `friends` to `{ ids: new Set(), names: new Set() }`, `emptyScans` to `0`. |
| `fbJob.init()` | `bot_cx.js:146-201` | Launches Chromium with stealth plugin, emulates an iPhone 12 profile, overrides viewport, disables navigation timeout, applies the cookie, registers silent `error`/`pageerror` handlers, navigates to `https://m.facebook.com/`. When `config.friendsOnly` is on, then calls `loadFriends()` and **exits the process (code 1)** if the resulting friend set is empty — otherwise the bot would silently like nothing and thrash through repeated empty-scan restarts. Prints `Lọc bạn bè: N id, M tên` on success. |
| `fbJob.toFriendSet(ids, names)` | `bot_cx.js:207-212` | Builds the normalized `{ ids: Set, names: Set }` structure used internally: ids lowercased, names passed through `normalizeName`. |
| `fbJob.loadFriends()` | `bot_cx.js:221-259` | **Scraping-free as of this version.** Resolves the friend list in priority order: (1) `friendsFile` has `"manual": true` → use it forever, never re-scrape; (2) file is a Facebook "Download Your Information" export (`friends_v2` array present) → name-only matching; (3) cached file younger than `config.friendsCacheDays` → reuse; (4) **nothing left to try** → print an error telling the operator to run `npm run friends`, and return an empty `{ ids: [], names: [] }` set (`bot_cx.js:255-258`). The bot itself never scrapes — see [Friends list file](#friends-list-file-friendsjson) below and [get_friends.js function table](#functions-get_friendsjs). |
| `fbJob.getPostAuthor($)` | `bot_cx.js:269-279` | Walks a post's `a[href]` links in DOM order and returns `{ key, name }` for the first one `profileKey` accepts. Rationale: the first profile link in a post is almost always the header author, so this avoids depending on a specific CSS class Facebook can rename — see [code-standards.md](./code-standards.md#prefer-dom-orderstructural-heuristics-over-css-class-selectors). |
| `fbJob.isFriend(author)` | `bot_cx.js:281-287` | `true` if `author.key` is in `friends.ids`, or `normalizeName(author.name)` is in `friends.names`. |
| `fbJob.scroll(amount)` | `bot_cx.js:293-298` | Runs `window.scrollBy(0, amount)` in-page. Correctly `await`s the `page.evaluate` call — previously (documented as a bug in an earlier version of this file) the method was declared `async` but did not await it, leaving an unawaited floating promise. **Fixed**: `scroll()` now only resolves once the in-page scroll call itself has resolved. |
| `fbJob.findPostAndLike()` | `bot_cx.js:300-401` | The like pipeline: DOM extraction → cheerio filtering → friends check → random pick → click. Also owns the empty-scan counter and the eventual full-session restart. Detailed in [system-architecture.md](./system-architecture.md#like-pipeline-data-flow). |
| `fbJob.start()` | `bot_cx.js:403-447` | Resets `stop`, calls `init()`, waits 1–5s, starts the 3000ms task-producer `setInterval`, kicks off `handleTask()`. |
| `fbJob.handleTask()` | `bot_cx.js:449-481` | Recursive async consumer loop: checks slow network, pops one task, dispatches on `task.type`, waits 1000–10000ms, recurses. |
| `fbJob.checkSlowNetwork()` | `bot_cx.js:483-493` | One-shot: if a `#load-time-out-banner a` element is present, sets `slowNetwork = true` (so this never runs its body again), clicks the banner link, waits 5s. |
| `readCookie(cookieFile='cookie.txt')` | `bot_cx.js:496-503` | Reads and returns the cookie file's raw text. If the file is missing, prints an error and calls `process.exit(1)`. **Corrected from a prior `process.exit(0)`**, which wrongly signalled success on a missing-cookie failure — see [code-standards.md](./code-standards.md#error-handling--current-state-and-what-to-change). Exported; used identically by both `bot_cx.js` and `get_friends.js`. |
| Entry-point guard | `bot_cx.js:507-512` | `if (require.main === module) { ... }` — constructs `fbJob` and calls `.start()` only when `bot_cx.js` is run directly (`node bot_cx.js` / `npm start`). When `require`'d instead (as `get_friends.js` does, for the shared helpers), the bot does **not** auto-start. This is the project's first module boundary — see [code-standards.md](./code-standards.md#module-boundary-convention). |
| `module.exports` | `bot_cx.js:514-524` | `{ fbJob, config, iPhone12, profileKey, normalizeName, cookieStringToObj, readCookie, wait, random }` — everything `get_friends.js` needs, and nothing that would duplicate stealth/browser setup. |

## Functions (`get_friends.js`)

Standalone script, `npm run friends` / `node get_friends.js` (flags: `--debug`, `--show`,
`--force`, `--from-html <file>` — see [README.md](../README.md#danh-sách-bạn-bè)).
Requires `./bot_cx.js` purely for helpers (`bot_cx.js:20`); safe because of the
`require.main` guard above. As of this version there are **two independent acquisition
paths** that both end up funneled through the same `collect()`/`save()` helpers: a live
browser scrape (unreliable against a real account so far — see
[project-overview-pdr.md](./project-overview-pdr.md#constraints--risks)), and
`--from-html`, which parses a hand-saved friends-page HTML file with no browser and no
cookie at all. `--from-html` is currently the **known-working** path.

| Symbol | Location | What it does |
|---|---|---|
| `FORCE` | `get_friends.js:24` | `process.argv.includes('--force')`. Set when `--force` is passed. Changes *write* behavior (via `save()`), not scrape/debug/input-source behavior. |
| `FROM_HTML` | `get_friends.js:26-27` | `process.argv[indexOf('--from-html') + 1]`, or `null` if the flag wasn't passed. The path to a hand-saved friends-page HTML file. Its presence is the single branch point between the two acquisition paths — checked once, at the very top of the IIFE. |
| `FRIEND_URLS` | `get_friends.js:30-35` | Ordered list of candidate friends-list URLs to try (**live-scrape path only** — irrelevant when `--from-html` is used). **`https://m.facebook.com/friends/?target_pivot_link=friends`** (the URL that actually worked when the operator first tested it) is first; `/friends/list/`, then `/friends/center/friends/` — the URL that previously failed to return anything and used to be the only one tried — then `/me/friends` follow as fallbacks. All four have since been confirmed unreliable in further testing; see the roadmap note in [project-overview-pdr.md](./project-overview-pdr.md#known-gaps--roadmap). |
| `MIN_EXPECTED` | `get_friends.js:38` | `5`. Live-scrape path only. A scrape yielding fewer profiles than this is treated as a miss: `diagnose()` runs automatically and the next `FRIEND_URLS` candidate is tried. |
| `NEXT_LABELS` | `get_friends.js:40` | Click-target text for "load more" affordances: `'xem thêm'`, `'see more'`, `'xem tất cả'`, `'see all'`, `'tải thêm'`, `'load more'`. Live-scrape path only — `--from-html` relies on the operator having already scrolled to the bottom before saving the page (see README). |
| `expandList(page)` | `get_friends.js:43-72` | Up to 80 rounds of: click any element whose trimmed lowercase text matches `NEXT_LABELS`, scroll `window.scrollBy(0, 3000)`, wait a random 1.2–2.2s (`wait(1200, 2200, true)`). Counts `a[href]` after each round; stops early once that count is unchanged for 3 consecutive rounds. Live-scrape path only. |
| `diagnose(links)` | `get_friends.js:75-98` | **The key debugging affordance**, shared by both acquisition paths. Given every `{href}` harvested, prints: total `a[href]` count, the 25 most common URL pathnames with counts, and up to 25 sample hrefs that `profileKey` rejected (truncated to 120 chars). On the live-scrape path it runs automatically whenever a scrape yields fewer than `MIN_EXPECTED` profiles (or always, with `--debug`); on the `--from-html` path it runs only under `--debug` (there's no "too few" threshold to auto-trigger it, since a hand-saved page is a one-shot input). |
| `collect(links)` | `get_friends.js:101-119` | **New shared helper**, used by both `scrapeFrom()` and `parseHtmlFile()`. Takes `[{href, text}]`, resolves each `href` through `profileKey`, and folds them into a `Map` keyed by profile key — first occurrence wins the slot, but a later occurrence with a "name-looking" `text` (trimmed length 2–59) fills in a name if the first occurrence didn't have one. Returns `{ ids, names }`. Replaces what used to be an inline dedupe loop duplicated between the two callers. |
| `parseHtmlFile(file)` | `get_friends.js:122-142` | The `--from-html` path's entry point. Verifies `file` exists (`process.exit(1)` if not), logs the file size in KB, loads it with `cheerio.load()`, extracts every `a[href]` + its trimmed text, calls `collect()`, logs the link/profile/name counts, and runs `diagnose()` when `--debug` is set. Works against both `www.facebook.com` (desktop) and `m.facebook.com` (mobile) saved HTML — `profileKey` needed no changes to handle desktop profile URLs. Returns `{ ids, names }`. |
| `scrapeFrom(page, url)` | `get_friends.js:144-167` | Live-scrape path. Navigates to `url`, logs the post-redirect URL (Facebook redirects a lot), calls `expandList`, harvests every `a[href]` + its text, and now **delegates to `collect()`** (`get_friends.js:157`) instead of the inline dedupe loop from the previous version. If `DEBUG` is set or the yield is below `MIN_EXPECTED`, calls `diagnose()` and writes `debug_friends.html`. Returns `{ ids, names }`. |
| `save(result)` | `get_friends.js:170-199` | **New shared helper**, factored out of the main IIFE so both acquisition paths write through the same guarded path. Unless `--force` was passed, reads any existing `friends.json` and, if it parses with `manual === true`, refuses to overwrite — prints the count just acquired, states nothing was saved, points at `--force`, sets a non-zero exit code, and returns `false`. An existing file that fails to parse (corrupt JSON) is **not** treated as protected: warns and proceeds to overwrite. On success: writes `{ at: Date.now(), ids, names }` to `config.friendsFile`, prints the "People You May Know / navigation-link contamination" warning (now mentioning both `"manual": true` and `--force`), and returns `true`. |
| IIFE main | `get_friends.js:201-249` | First checks `FROM_HTML` (`get_friends.js:203-206`): if set, calls `save(parseHtmlFile(FROM_HTML))` and returns immediately — **no browser is launched at all** on this path. Otherwise falls through to the live-scrape path: launches Chromium (headless unless `--show`), emulates `iPhone12`, applies the cookie via `readCookie()`/`cookieStringToObj()`, tries each `FRIEND_URLS` entry via `scrapeFrom` until one yields `>= MIN_EXPECTED` profiles, and on total failure sets `process.exitCode = 1` with a message pointing at `debug_friends.html` + diagnostics or at hand-writing `friends.json` (`get_friends.js:237-243`). On any scrape success, calls `save(result)` (`get_friends.js:245`). Always closes the browser in a `finally` block — irrelevant on the `--from-html` path, since that branch returns before the browser is ever created. |

## Timing and randomization constants

Most human-pacing behavior lives inline in `bot_cx.js`; the friends-only feature's own
tunables (cache age, empty-scan threshold) now live in the `config` block instead — see
[Config block](#config-block-bot_cxjs11-30) above.

| Constant | Value | Location |
|---|---|---|
| Task-producer tick | every 3000ms | `bot_cx.js:443` |
| SCROLL tasks per batch | 3–6 (`random(2,5) + 1` iterations) | `bot_cx.js:421` |
| SCROLL amount per task | `random(-300, 400)` px (negative = scroll up) | `bot_cx.js:424` |
| WAIT-task insertion odds | `random(10,1000) % 13 == 0` → ~1/13 batches | `bot_cx.js:432-433` |
| WAIT-task duration | `random(60, 120)` seconds | `bot_cx.js:434` |
| Inter-task delay (consumer loop) | `random(1000, 10000)` ms | `bot_cx.js:478` |
| Startup settle after launch | `random(1, 5)` seconds | `bot_cx.js:408` |
| Empty-scan scroll amount (pulls in new posts before rescanning) | `random(600, 1200)` px | `bot_cx.js:359` |
| Empty-scan threshold before full restart | `config.maxEmptyScans` = 8 consecutive empty scans | `bot_cx.js:357, config:26` |
| Restart delay after full-restart teardown | `random(5000, 15000)` ms | `bot_cx.js:370` |
| Post-reload settle (after a WAIT task) | 5 seconds | `bot_cx.js:472` |
| Slow-network banner settle | 5 seconds | `bot_cx.js:491` |
| Friend-list cache lifetime | `config.friendsCacheDays` = 7 days | `config:23` |

Friend-list scraping now lives entirely in `get_friends.js` and has moved out of this
table into its own tuning constants:

| Constant | Value | Location |
|---|---|---|
| Candidate URLs, tried in order | `FRIEND_URLS` (4 entries, primary first — see [get_friends.js function table](#functions-get_friendsjs)) | `get_friends.js:30-35` |
| Minimum profiles to accept a scrape | `MIN_EXPECTED` = 5 | `get_friends.js:38` |
| Expand-list rounds | up to 80 | `get_friends.js:47` |
| Expand-list scroll amount per round | 3000px | `get_friends.js:56` |
| Expand-list settle per round | `wait(1200, 2200, true)` (1.2–2.2s) | `get_friends.js:57` |
| Expand-list stability threshold | 3 consecutive rounds with no new links | `get_friends.js:62` |

## DOM selectors the bot depends on

**This is the most fragile part of the codebase.** Every selector below targets
Facebook's mobile web (`m.facebook.com`) markup, which is not a stable/versioned public
API. Any Facebook markup change can silently break liking (posts stop being found) or
worse, cause mis-detection (already-liked posts get re-clicked, or foreign posts slip
through, or friend detection misfires).

| Selector / pattern | Used for | Location |
|---|---|---|
| `div[data-tracking-duration-id][data-tti-phase][data-mcomponent="MContainer"]` | Identifying feed post containers to extract | `bot_cx.js:306` |
| `/Suggested for you\|Sponsored\|tài trợ/` | Legacy ad/suggested-post filter, still applied as a first pass before the friends check | `bot_cx.js:308` |
| `[data-long-click-action-id][data-comp-id]` | Existence check ("does this post have a like action"), already-liked detection, and id extraction — **all three now use the same strict selector**, stored once as `selector` | `bot_cx.js:316, 320, 337, 340` |
| `a[href]` (walked in DOM order, resolved through `profileKey`) | Post-author identification (`getPostAuthor`) — deliberately not a CSS-class selector; see [code-standards.md](./code-standards.md#prefer-dom-orderstructural-heuristics-over-css-class-selectors) | `bot_cx.js:269-279` |
| `div.bg-s3:nth-child(2) .native-text` (text split at `"See more"`) | Extracting post body text | `bot_cx.js:336` |
| `button.native-text span:first-child` with inline style `color:#0d83ff;` | Detecting whether a post is **already liked** | `bot_cx.js:337` |
| `/Xem bản dịch\|Được dịch từ Tiếng/` | Filtering out machine-translated / foreign-language posts | `bot_cx.js:341` |
| `#load-time-out-banner a` | Detecting Facebook's own "slow connection" banner | `bot_cx.js:485` |
| `a[href]` on each `FRIEND_URLS` candidate (walked with link text, resolved through `profileKey`) | Harvesting the friend list on the live-scrape path — in the standalone `scrapeFrom()`, **not** in `bot_cx.js` at all | `get_friends.js:151-155` |
| `a, button, div[role="button"]` matching `NEXT_LABELS` text | Clicking "load more"/"see more" affordances while expanding the friends list (live-scrape path only) | `get_friends.js:48-54` |
| `a[href]` in a hand-saved HTML file, read via `cheerio.load()` (resolved through `profileKey`) | Harvesting the friend list on the `--from-html` path, in `parseHtmlFile()` — a static-HTML parse, not a live page, so nothing here can be "broken by a Facebook markup change" mid-run the way the other rows can | `get_friends.js:131-134` |

**Previously documented bug, now fixed**: an earlier version of this file noted that the
existence check used the loose selector `[data-long-click-action-id]` while the
already-liked check and id extraction just below it used the stricter
`[data-long-click-action-id][data-comp-id]`. A post matching only the loose selector
would pass the existence check but then yield `id === undefined`, producing a dead
selector like `[data-long-click-action-id="undefined"]` that matched nothing on the
next lookup — such a post was silently skipped rather than liked. As of this version,
`findPostAndLike()` declares the strict selector once (`bot_cx.js:316`) and reuses it for
the existence check, the liked check, and id extraction (`bot_cx.js:320, 337, 340`), so
this class of bug can no longer occur.

**The friends-center DOM was never actually verified.** The selector row above for
`get_friends.js` walks *every* `a[href]` on the page rather than a friends-specific
container, for the same reason the old in-bot scrape did: without a logged-in session to
inspect, no more specific container selector could be confirmed. What changed is where
that risk lives — see [Friends list file](#friends-list-file-friendsjson) below for why
`https://m.facebook.com/friends/center/friends/` (the URL this used to hit exclusively)
is now only the **third** fallback, not the primary target.

## Friends list file (`friends.json`)

Written by `get_friends.js`'s `save()` helper (`get_friends.js:170-199`) — called from
either acquisition path's branch of the IIFE main (`get_friends.js:201-249`) — and read
by `bot_cx.js`'s `loadFriends()` (`bot_cx.js:221-259`) — not committed to git (see
`.gitignore`). These two scripts never run in the same process; the file on disk is the
only thing that connects them. See [system-architecture.md](./system-architecture.md#friend-list-lifecycle)
for the two-process operational model this enables. Two shapes are accepted:

1. **Scraped format** (what `get_friends.js` writes):
   ```json
   { "at": 1755878400000, "ids": ["100012345678901", "nguyen.van.a"], "names": ["Nguyễn Văn A"] }
   ```
   `at` is a `Date.now()` timestamp used against `config.friendsCacheDays` to decide
   whether the bot must be re-pointed at a fresh scrape (it never triggers one itself —
   see [Friend-list lifecycle](./system-architecture.md#friend-list-lifecycle)). `ids`
   are `profileKey` results (numeric ids or usernames, lowercased); `names` are raw link
   text, matched via `normalizeName` at lookup time.

2. **Facebook "Download Your Information" (DYI) export format** — detected by the
   presence of a `friends_v2` array:
   ```json
   { "friends_v2": [{ "name": "Nguyễn Văn A", "timestamp": 1600000000 }, ...] }
   ```
   Only `name` is used (mapped into the `names` set); this file has no ids, so matching
   falls back entirely to normalized display-name comparison — weaker than id matching
   (duplicate names, name changes, diacritics). See the risk entry in
   [project-overview-pdr.md](./project-overview-pdr.md#constraints--risks).

A top-level `"manual": true` flag (only meaningful on the scraped-format shape) now has
**two independent effects, one on each side of the file**:

- **Read side, `bot_cx.js`'s `loadFriends()`** (`bot_cx.js:238-241`): use the file
  forever, skip the `config.friendsCacheDays` age check entirely — a manual file never
  counts as stale.
- **Write side, `get_friends.js`'s `save()` helper** (`get_friends.js:170-199`): before
  writing a freshly acquired list — from either acquisition path — read whatever
  `friends.json` currently contains; if it parses and `manual === true`, refuse to
  overwrite — print the count just acquired, state clearly that nothing was saved, point
  at `--force`, and exit non-zero. Pass `--force` to overwrite it anyway. An existing file
  that fails to parse (corrupt JSON) is **not** treated as protected — `get_friends.js`
  warns and overwrites it, on the reasoning that a corrupt file shouldn't be able to
  permanently block a rescan.

Together these make `"manual": true` mean what an operator would expect it to mean: "this
is the list, don't touch it" — both the bot's own staleness check and a future `npm run
friends` respect that until the operator explicitly overrides one side (edit the flag) or
the other (`--force`). This is the intended workflow after hand-editing the file to
remove strangers picked up by the scrape. See
[README.md](../README.md#danh-sách-bạn-bè) for the operator-facing walkthrough.

## What does not exist in this repo

To avoid any reader assuming standard project scaffolding is present:

- No automated tests (`npm test` is a placeholder that exits 1). The friends-matching
  logic (`profileKey`, `getPostAuthor`, `isFriend`) was exercised with ad-hoc scratch
  scripts during development (17/17 real-world href shapes, 8/8 mock-post fixtures — see
  [code-standards.md#testing](./code-standards.md#testing)), but those scripts were not
  committed and there is still no test suite in the repo.
- No CI/CD configuration (no `.github/workflows`, no other CI config found).
- No linter or formatter configuration (no `.eslintrc*`, no `.prettierrc*`).
- No TypeScript — plain CommonJS JavaScript.
- No database, no HTTP server, no exposed API.
- No environment-variable based configuration (`.env` is not read anywhere) — the new
  `config` block (`bot_cx.js:11-30`) is still a hardcoded object in source, not
  externalized.
- No logging framework — plain `console.log`/`console.error`, largely commented out.
- No cookie-refresh mechanism, despite a partially-written, fully commented-out block
  for capturing `set-cookie` response headers referencing an undefined `getCookie`
  function that does not exist elsewhere in the file.
