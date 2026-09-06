# Project Overview & Product Development Requirements

> For the technical inventory backing these requirements, see
> [`codebase-summary.md`](./codebase-summary.md) and
> [`system-architecture.md`](./system-architecture.md). For contribution conventions,
> see [`code-standards.md`](./code-standards.md).

## What this project is

`fb_bot` ("Bot cảm xúc" — reaction/emotion bot) is a small Node.js tool, split into two
scripts, that drives a headless, stealth-patched Chromium browser via Puppeteer against
Facebook mobile web. The main script (`bot_cx.js`, ~524 lines) automatically scrolls a
Facebook feed and "likes" a randomly selected, not-yet-liked, non-sponsored,
non-foreign-language post **authored by one of the operator's Facebook friends**, on a
human-paced loop, indefinitely. A second, standalone script (`get_friends.js`, ~249
lines, run via `npm run friends`) populates the friend list that filtering depends on —
via a live browser scrape (unreliable so far) or by parsing a friends-page HTML file the
operator saved by hand (`--from-html`, currently the working path) — see
[system-architecture.md#two-process-operational-model](./system-architecture.md#two-process-operational-model)
for why that's a separate script rather than a step inside the bot.

It is a personal-use automation tool, not a product, service, or platform. There is no
UI, no API, no multi-user support, and no persistence layer beyond a cookie file and a
friend-list cache file on disk.

## Target user

A single individual automating engagement on **their own** personal Facebook account.
The README is explicit that the bot supports exactly one account per run and recommends
running it on the same physical machine the operator normally uses to browse Facebook,
to keep the traffic's apparent origin consistent with the account's normal usage
pattern. There is no concept of multiple accounts, teams, or delegated access anywhere
in the code.

## Problem it addresses

Manually scrolling and reacting to posts to keep an account's engagement activity
looking organic is repetitive. This tool automates that repetitive action while trying
to preserve the *appearance* of organic, human behavior closely enough to avoid
triggering Facebook's automation/bot detection — and, since the friends-only filtering
described below, while restricting that engagement to the operator's actual social
graph rather than every post the feed algorithm happens to surface.

## Goals

- Continuously and unattended like posts in the operator's own Facebook feed over long
  running periods (hours+), without operator interaction after startup.
- Look as close to human browsing behavior as practical, specifically:
  - randomized scroll distances and directions (including backwards scrolling),
  - randomized pacing between actions (1-10 seconds between queued tasks),
  - randomized batch composition (3-6 scrolls per batch, occasional longer pauses),
  - a stealth-patched browser fingerprint (`puppeteer-extra-plugin-stealth`) and a
    mobile (iPhone 12) device/viewport emulation rather than a generic headless
    fingerprint.
- **Only like posts from friends.** Originally this project tried to exclude
  Sponsored/Suggested posts with a blacklist — a regex over post HTML for strings like
  `Suggested for you`, `Sponsored`, `tài trợ`. That approach could never be complete
  (Facebook keeps introducing new suggested-post formats) and never worked for this
  operator's account in the first place, since the account's UI locale is Vietnamese and
  those blacklist strings are English. It has been replaced with a positive whitelist:
  a post is only liked if its author matches an entry in the operator's own friend list.
  The old blacklist regex is still applied first as a cheap early filter, but the
  friend-authorship check is now the real gate. See
  [system-architecture.md#like-pipeline-data-flow](./system-architecture.md#like-pipeline-data-flow)
  and [codebase-summary.md#config-block-bot_cxjs11-30](./codebase-summary.md#config-block-bot_cxjs11-30).
- Avoid re-liking already-liked posts, and avoid liking foreign-language
  (auto-translated) posts.
- Recover automatically from transient "nothing to like right now" states by scrolling
  for more content, and fall back to a full session restart only after sustained
  failure — see
  [system-architecture.md#process-lifecycle--state-machine](./system-architecture.md#process-lifecycle--state-machine).
- Require minimal setup: a single cookie value, `npm install`, and a two-step run —
  `npm run friends` once (and again whenever the list needs refreshing) to populate
  `friends.json`, then `npm start` (optionally under PM2 for supervision) — see
  [README.md](../README.md#danh-sách-bạn-bè).

## Non-goals

Stated explicitly so nobody mistakes an absence for an oversight:

- **Not multi-account.** One `fbJob` instance holds one cookie for one account per
  process. Running several accounts means running several independent processes/PM2
  apps by hand; nothing in the code coordinates or rate-limits across instances.
- **Not a general Facebook automation framework.** The bot itself does exactly two page
  actions — scroll and like — plus a page reload; it does not comment, share, post,
  message, friend/follow, or read notifications. Friend-list scraping (`get_friends.js`)
  is a separate standalone script, not something `bot_cx.js` does as part of its own
  operation — see
  [system-architecture.md#two-process-operational-model](./system-architecture.md#two-process-operational-model).
- **Not a login/credential manager.** It has zero login flow. It only ever consumes a
  pre-obtained cookie string; it does not know the account's password, does not handle
  2FA, and does not detect or recover from a logged-out state beyond whatever generic
  behavior falls out of the like pipeline finding no candidates.
- **Not a friend-graph management tool.** `friends.json` is a local matching cache the
  bot reads, not a synced or continuously-updated model of the account's real friend
  list. Nothing in the bot adds, removes, or requests friends.
- **Not built for scale, multi-tenancy, or headless-server deployment behind a queue/API.**
  There is no server, no queue beyond the single in-memory array, no persistence beyond
  a couple of local files, and no remote control surface.
- **Not guaranteed compliant with Facebook's Terms of Service.** See
  [Constraints & risks](#constraints--risks).

## Functional requirements (as implemented)

1. On startup, read a Facebook session cookie from `cookie.txt` via the shared
   `readCookie()` helper; exit immediately with an error (`process.exit(1)`) if the file
   is absent (`bot_cx.js:496-503, 507-512`).
2. Launch a stealth-patched, mobile-emulated headless Chromium session and authenticate
   to `m.facebook.com` using only that cookie (no interactive login).
3. When `config.friendsOnly` is enabled (the default), resolve a friend list before
   starting the task loop, purely by reading `friends.json` from disk: reuse a
   hand-marked (`"manual": true`) file, a Facebook DYI export, or a cache younger than
   `config.friendsCacheDays` (`bot_cx.js:189-200, 221-259`). **The bot does not scrape.**
   If none of those apply — file missing, or cache stale — print an error telling the
   operator to run `npm run friends`, and resolve an empty list. If the resolved list is
   empty, exit with an error (`process.exit(1)`) rather than run with an empty filter.
4. Continuously scroll the feed in randomized amounts and directions.
5. Periodically scan currently-rendered posts and like at most one per `LIKE` task,
   selected at random among eligible candidates.
6. Skip posts that are sponsored/suggested (legacy blacklist), authored by someone not
   in the resolved friend list (when `friendsOnly` is on), already liked, or detected as
   foreign-language/auto-translated.
7. When `config.verifyMode` is enabled (the default), log every scanned post's detected
   author and whether it matched a friend, so the operator can verify extraction and
   matching before trusting the bot unattended.
8. Occasionally (about 1 in 13 task batches) pause for 60-120 seconds and reload the
   page, simulating a longer human break.
9. Detect a page-load "slow connection" banner once and dismiss it.
10. If a scan finds zero like candidates, scroll for more content and keep going; only
    after `config.maxEmptyScans` (8) consecutive empty scans, restart the entire browser
    session after a short randomized delay, rather than getting stuck.
11. Run under `npm start` directly, or under PM2 via `ecosystem.config.js` for process
    naming/log timestamping (without crash auto-restart — `autorestart: false`).

## Non-functional requirements (inferred from behavior)

- **Human-like pacing over throughput.** Every delay in the system is intentionally
  randomized rather than fixed or minimized; the design explicitly trades speed for
  believability. Any future change that makes timing more deterministic or faster
  works against this project's actual purpose.
- **Detection avoidance over robustness.** The stealth plugin, mobile emulation, and
  randomization all exist to reduce the chance of the *account* being flagged, not to
  make the *script* resilient to Facebook markup changes — those remain brittle by
  design tradeoff (see risks below). This now extends to the friends-center scrape,
  which uses the same emulated-mobile approach as the main feed.
- **Positive filtering over blacklisting, matched by stable identity.** The friends-only
  redesign reflects a broader principle for this project going forward: prefer an
  allowlist keyed on something stable (a profile id or username) over a denylist keyed
  on brittle, locale-dependent, or display-only signals (English marketing strings,
  human display names). See
  [code-standards.md#match-by-stable-id-not-display-name](./code-standards.md#match-by-stable-id-not-display-name).
- **Verify before trusting unattended.** `config.verifyMode` exists so a new or changed
  filtering mechanism is observed operating correctly (via console output) before the
  operator lets the bot run unattended for hours. See
  [code-standards.md#verify-before-trust-workflow](./code-standards.md#verify-before-trust-workflow).
- **Single-account, single-machine, unattended operation.** The system must be able to
  run for long unattended stretches without a human present, recovering from transient
  "no candidates" states, and otherwise expected to be monitored externally (e.g. via
  `pm2 logs`) rather than self-diagnosing.
- **Low operational footprint.** No database, no external services beyond Facebook
  itself, no secrets manager — a cookie file and a friend-list JSON file are the entire
  persistence layer. Any future requirement must weigh added operational complexity
  against this project's minimal-footprint nature before assuming a bigger dependency is
  warranted.

## Constraints & risks

- **Facebook DOM/markup fragility.** The like pipeline depends on a specific set of
  CSS/attribute selectors on `m.facebook.com` (documented in full in
  [codebase-summary.md#dom-selectors-the-bot-depends-on](./codebase-summary.md#dom-selectors-the-bot-depends-on)).
  Facebook does not publish or version this markup; any redesign of the mobile feed can
  silently break post discovery, already-liked detection, or foreign-post filtering
  with no warning from the bot itself (errors are swallowed — see below).
- **Live scraping of the friends-list page is validated as unreliable — twice over — and
  offline parsing of a hand-saved page is validated as working.** The first round of
  testing found `m.facebook.com/friends/center/friends/` — the only URL the original
  in-bot scrape tried — returned nothing at all against a real logged-in account. The
  operator identified a different URL,
  `https://m.facebook.com/friends/?target_pivot_link=friends`, that worked once, and
  `get_friends.js` was updated to try it first, with `/friends/list/`,
  `/friends/center/friends/`, and `/me/friends` as ordered fallbacks
  (`get_friends.js:30-35`). **A further round of testing found live scraping still
  returned nothing** — none of the four `FRIEND_URLS` candidates reliably worked. What
  *did* work: the operator saved the friends page's HTML by hand — critically, from
  **`www.facebook.com` (desktop)**, not `m.facebook.com` (mobile), with modern obfuscated
  React class names — and `get_friends.js --from-html <file>` parsed it with **zero code
  changes needed to `profileKey`**: 838 `a[href]` → 288 unique profiles, all with names
  attached. That result was independently cross-validated by extracting the profile set
  implied by `/<user>/friends_mutual` links on the same saved page (232 entries) and
  confirming it is a strict subset of the 288 with zero missing — the extra 56 are
  presumed to be friends with no mutual friends, so no "bạn chung" link renders for them.
  Conclusion: the friends-list *live* DOM remains as unverified and brittle as ever (no
  guarantee any `FRIEND_URLS` candidate keeps working, or is the same URL that works for
  every account), but hand-saved HTML plus offline parsing is now a demonstrated,
  repeatable way around that brittleness entirely — see
  [system-architecture.md#friend-list-lifecycle](./system-architecture.md#friend-list-lifecycle).
- **Friend-list scrape may include strangers.** Whichever friends-list page is used, it
  can also render a "Những người bạn có thể biết" (People You May Know) section, and the
  exact container selector needed to scope harvesting to only the real friends list has
  **still not been verified** against real logged-in HTML — this remains the top open
  item, see [Known gaps / roadmap](#known-gaps--roadmap) below. Until that's confirmed,
  every scrape can pick up non-friends, silently widening who gets liked. `get_friends.js`
  mitigates this with a loud console warning telling the operator to check `friends.json`
  and hand-fix it with `"manual": true`, but that mitigation depends on the operator
  actually reading the console output.
- **Friend list requires a manual refresh step, and staleness is now a hard stop — and
  the manual step now typically involves a human saving a web page, not just running a
  command.** Friend list acquisition is a separate, manually-run process (`npm run
  friends`) — the bot is not self-maintaining and never re-scrapes on its own. With live
  scraping still unreliable (see above), the practical refresh workflow today is: open
  the friends page in a normal logged-in browser, scroll to the bottom so every friend is
  actually rendered, save the HTML, then run `get_friends.js --from-html <file>` — a
  strictly more manual step than "run one command unattended." Non-manual `friends.json`
  is considered stale after `config.friendsCacheDays` (7 days); previously that triggered
  a silent in-bot re-scrape, but as of this version a stale or missing file makes
  `loadFriends()` resolve an empty set, which trips `init()`'s existing empty-friend-list
  guard and the bot **refuses to start** (`process.exit(1)`) until the operator redoes
  that refresh. A friend added or removed since the last refresh also won't be reflected
  in filtering until it's redone.
- **DYI name-matching is weaker than id matching.** When `friends.json` is a Facebook
  "Download Your Information" export (`friends_v2`), there are no profile ids in the
  file — only display names, matched via `normalizeName`. Display names are not a
  stable identity: duplicate names collide, accented/Vietnamese names can be entered
  inconsistently across contexts, and a person can rename their account, silently
  breaking a previously-working match. This path exists because it's the only data an
  operator can get without the bot scraping the friends-center page itself, not because
  it's the preferred mechanism.
- **Cookie expiry with no refresh path.** Authentication is a single static cookie
  string read once at startup. There is a substantial, fully commented-out block in
  `bot_cx.js` that appears to be an abandoned attempt at capturing refreshed cookies from
  `set-cookie` response headers, referencing an undefined `getCookie` helper. As shipped,
  once the session cookie in `cookie.txt` expires or is invalidated, the bot has no way
  to detect that specifically or re-authenticate — it will most likely just stop finding
  usable content and loop through its empty-scan/restart path indefinitely, or error out
  of a Puppeteer call.
- **Silent error handling.** `fbPage.on('error', ...)` and `fbPage.on('pageerror', ...)`
  are both registered with empty bodies (`bot_cx.js:178-184`) — in-page JavaScript
  errors and crashes are invisible to the operator by design of the current code. This
  makes diagnosing "why did it stop liking things" harder than it needs to be.
- **Account checkpoint/ban risk.** This tool automates interaction with a real personal
  account using a stealth-patched headless browser, which is precisely the kind of
  activity Facebook's automation detection is built to catch. The README's own guidance
  (run it on the account owner's usual machine) is itself a risk-mitigation, not a risk
  elimination. Sustained automated liking, however randomized and however narrowly
  targeted at friends' posts, carries real risk of the account being checkpointed,
  rate-limited, or banned.
- **Facebook Terms of Service.** Automating interactions with a personal account
  through unofficial means is very likely to violate Facebook's Terms of Service.
  This documentation does not represent a legal assessment of Vietnamese or
  international law regarding automated account activity — it is an engineering
  description of what the code does. Anyone operating this bot does so at their own
  risk and is responsible for their own compliance decisions.
- **Unpinned dependencies.** `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, and
  `cheerio` are all pinned to `*` in `package.json`, and `package-lock.json` is
  git-ignored — see
  [codebase-summary.md#dependencies-packagejson](./codebase-summary.md#dependencies-packagejson).
  A fresh `npm install` on a different machine or at a different time can silently pull
  different versions, including breaking changes in the stealth plugin's fingerprinting
  behavior.
- **Cookie parsing edge case.** `cookieStringToObj` (`bot_cx.js:48-62`) splits each
  `name=value` pair on the first `=` only by array index (`cur[0]`, `cur[1]`), so any
  cookie value that itself contains an `=` character (common in base64-padded cookie
  values) is silently truncated rather than preserved in full. This could cause an
  otherwise-valid cookie to fail authentication with no clear error message.

## Success metrics (as observable today)

The code itself only exposes one running metric: `this.total`, an in-memory count of
successful likes since the current browser session started, printed to the console
after each like (`bot_cx.js:450`, `'Tổng đã like: '`). It is not persisted across
restarts (including the empty-scan self-restart) and not exposed anywhere outside
stdout. Startup additionally prints the resolved friend-list size once
(`bot_cx.js:199`, `'Lọc bạn bè: N id, M tên'`), and when `config.verifyMode` is on,
every scanned post's author-match result is logged — useful for manual verification, not
a metric that's aggregated anywhere. There is no dashboard, no structured metrics
export, and no historical tracking.

## Known gaps / roadmap

Listed by rough priority, grounded strictly in what the code does and does not do today
— not a commitment to build any of these, just a documented backlog:

1. **Make live scraping actually work — still the top item, now with a working
   fallback to lean on while it stays open.** Two rounds of testing have now shown
   `get_friends.js`'s live browser scrape (`FRIEND_URLS`, `scrapeFrom`) does not
   reliably return a friends list against a real account, even after correcting the
   primary URL once already. The container selector needed to also exclude "Những người
   bạn có thể biết" (People You May Know) has separately never been confirmed against
   real logged-in HTML either way. Neither problem is fixed by `--from-html` — it's a
   workaround, not a solution, and it trades "unattended refresh" for "a human has to
   save a page correctly." **Current supported workflow**: use
   `get_friends.js --from-html <file>` (see
   [README.md](../README.md#danh-sách-bạn-bè)) — this is validated (288 profiles,
   cross-checked against the `friends_mutual` subset, zero missing) and does not depend
   on solving the live-DOM problem. Making the live scrape reliable, and scoping either
   source to exclude non-friends, both remain open — see
   [Constraints & risks](#constraints--risks) above and
   [system-architecture.md#friend-list-lifecycle](./system-architecture.md#friend-list-lifecycle).
2. **Cookie refresh.** Finish or remove the abandoned `set-cookie` capture block in
   `bot_cx.js`; as-is it's dead code referencing an undefined function. Finishing it
   would directly address the "cookie expiry with no refresh path" risk above.
3. **Error visibility.** Give the silent `error`/`pageerror` handlers real bodies (at
   minimum logging), per the guidance in
   [code-standards.md#error-handling--current-state-and-what-to-change](./code-standards.md#error-handling--current-state-and-what-to-change).
4. **Config externalization.** The new `config` block
   (`bot_cx.js:11-30`, see
   [codebase-summary.md#config-block-bot_cxjs11-30](./codebase-summary.md#config-block-bot_cxjs11-30))
   centralizes tunables inside source, but they still require editing `bot_cx.js` and
   restarting the process to change — there is no env var or external config file yet.
   Some DOM selectors also remain hardcoded outside this block.
5. **No automated tests.** `npm test` is a placeholder. Ad-hoc scratch scripts were used
   to verify `profileKey`/`getPostAuthor`/`isFriend` during development but were not
   committed. See [code-standards.md#testing](./code-standards.md#testing) for a
   pragmatic starting point (unit-test the pure helpers first).
6. **Dependency pinning.** Replace the `*` version ranges for `puppeteer-extra`,
   `puppeteer-extra-plugin-stealth`, and `cheerio` with explicit versions, and stop
   git-ignoring `package-lock.json` if reproducible installs matter.
7. **Selector-change resilience.** No current mechanism distinguishes "the selectors
   stopped matching anything" from "there really are no more posts to like" — with
   friends-only filtering on, both now look like a long run of empty scans, which is
   even harder to tell apart from normal operation than before. A distinct signal for
   "selectors are probably stale" would materially shorten time-to-diagnosis when
   Facebook changes its markup.
