# Codebase Structure & Code Standards

> Describes conventions actually observed in `bot_cx.js` plus guidance for anyone
> extending it. For a function/selector inventory, see
> [`codebase-summary.md`](./codebase-summary.md); for how the pieces fit together at
> runtime, see [`system-architecture.md`](./system-architecture.md).

## Structure

The application lives in two files at the repo root: `bot_cx.js` (~524 lines, the bot)
and `get_friends.js` (~178 lines, the standalone friend-list scraper — see
[Module boundary convention](#module-boundary-convention) below for why it's a separate
file rather than a method on `fbJob`). There is no `src/`, no further module split, no
barrel files. This is appropriate for the project's current size; the guidance below
assumes that stays true, and flags where it would need to change if either file grows.

```
fb_bot/
├── bot_cx.js            # the bot; also the shared-helper module get_friends.js requires
├── get_friends.js       # standalone friend-list scraper — npm run friends
├── package.json
├── ecosystem.config.js  # PM2 config
├── cookie.txt           # gitignored secret, not committed
├── cookie.txt.example   # empty placeholder, committed
├── friends.json          # gitignored, personal data — see codebase-summary.md
├── README.md
└── docs/                # this directory
```

## Conventions in use today

These are descriptive — what the current code actually does — not aspirational.

- **Module system**: CommonJS throughout. `bot_cx.js` now has an explicit
  `module.exports` (`bot_cx.js:514-524`) — see
  [Module boundary convention](#module-boundary-convention) below — and `get_friends.js`
  is the one file in the repo that `require`s another local file. Do not introduce ESM
  (`import`/`export`) without also updating `package.json` (`"type": "module"`) and
  re-verifying every dependency's interop.
- **Indentation**: 4 spaces, no tabs, throughout.
- **Semicolons**: used consistently at statement ends.
- **Quotes**: single quotes for strings.
- **Function style**: standalone helpers (`cookieStringToObj`, `random`, `wait`,
  `profileKey`, `normalizeName`) are arrow functions assigned to `const`; the one
  stateful unit (`fbJob`) is a `class` with ordinary methods. There is no mixing of
  `function` declarations — pick arrow-const for free functions, `class` methods for
  anything that touches `this`.
- **Enums**: `taskTypes` is a plain object wrapped in `Object.freeze(...)`
  (`bot_cx.js:120-124`) rather than a `switch` on magic strings scattered around, or an
  external enum library. Follow this pattern for any new closed set of string constants.
- **Async style**: `async`/`await` throughout; no raw `.then()` chains except the two
  deliberate "fire and forget" call sites — `this.handleTask().then()` in `start()`
  (`bot_cx.js:445`) and the top-level `job.start().then(...)` inside the `require.main`
  entry-point guard (`bot_cx.js:509`) — both of which intentionally do not await a
  recursive/long-running loop from a non-async caller.
- **Sleeping**: always via the promise-based `wait()` helper (`bot_cx.js:68`), never
  blocking sleeps. `wait` takes a default unit of **seconds**; pass `true` as the third
  argument when you mean milliseconds. Keep using this helper for any new delay rather
  than inlining `new Promise(r => setTimeout(r, ...))`.
- **Randomization**: always via the inclusive `random(min, max)` helper
  (`bot_cx.js:64`), never `Math.random()` inlined. All human-pacing constants (scroll
  distance, batch size, delays) go through it — see the table in
  [codebase-summary.md](./codebase-summary.md#timing-and-randomization-constants).
- **State ownership**: all mutable runtime state (`browser`, `fbPage`, `tasks`, `total`,
  `slowNetwork`, `stop`, `taskInterval`, `friends`, `emptyScans`) lives on the single
  `fbJob` instance as `this.*` properties set in the constructor (`bot_cx.js:127-144`).
  There are no module-level `let`/`var` globals holding mutable state — `config` and
  `iPhone12` are module-level, but both are frozen/constant, never reassigned. Keep new
  mutable state on the instance, not as a free variable in the file.
- **User-facing logging language**: progress messages a human operator would read while
  the bot runs are in **Vietnamese** (e.g. `'Đang đăng nhập'`, `'Thấy N nút like'`, `'Đã
  like ...'`, `'Tổng đã like: '`, `'Lọc bạn bè: ...'`). A few incidental/debug-flavored
  messages are in English (`'opening facebook'`, `'pushed task: '`). This project's
  primary audience is a Vietnamese-speaking operator; keep new *operator-facing* log
  lines in Vietnamese for consistency, and keep this in mind if you add English strings
  — it's an existing inconsistency, not a rule to copy.
- **Debug logging**: many `console.log` calls are present but commented out rather than
  deleted, following a recent "hide console.log" cleanup commit. There is no log-level
  system (no debug/info/warn distinction) — it's a manual comment/uncomment convention.
  If verbose debugging becomes a recurring need, consider a single `DEBUG` env-var-gated
  helper instead of hand-toggling comments, but that is not the current pattern. The
  friends-only feature adds two more structured alternatives to this pattern instead of
  more commented-out lines — see
  [Verify-before-trust workflow](#verify-before-trust-workflow) below and
  `config.dumpDebugHtml` (writes `debug_post.html`/`debug_friends.html` instead of
  logging raw HTML to the console).

## Config block convention

`bot_cx.js:11-30` introduces the project's first centralized config block — a single
`Object.freeze(...)`-wrapped object declared at the very top of the file, above the
helper functions:

```js
const config = Object.freeze({
    friendsOnly: true,
    verifyMode: true,
    friendsFile: 'friends.json',
    friendsCacheDays: 7,
    maxEmptyScans: 8,
    dumpDebugHtml: false,
});
```

Before this, every tunable in the codebase was a magic number inline in whatever method
used it (see the [Timing and randomization
constants](./codebase-summary.md#timing-and-randomization-constants) table, most of
which still work that way — this block does not retroactively migrate them). Going
forward: **any new tunable that an operator might reasonably want to flip without
reading source line-by-line belongs in `config`, not hardcoded in a method body.** A
tunable earns a place here if it changes *behavior/policy* (on/off switches, thresholds,
file paths); a one-off literal that's really an implementation detail of a single
call site (e.g. a specific pixel scroll range) can stay inline unless there's a reason
an operator would want to change it. Each field should keep a short Vietnamese comment
explaining what it does and its default, matching the existing block.

## Module boundary convention

`get_friends.js` is the first file in this project to `require` another local file, and
`bot_cx.js` is the first file with an explicit `module.exports`. The pattern, worth
reusing for any future standalone tool that needs the bot's helpers:

1. **Guard the entry point.** `bot_cx.js` wraps its own startup in
   `if (require.main === module) { ... }` (`bot_cx.js:507-512`), so the file only
   auto-starts the bot when run directly (`node bot_cx.js` / `npm start`). When another
   script `require`s it instead, none of that side-effecting startup code runs — only the
   exports are evaluated.
2. **Export explicitly, and only what's reusable.** `bot_cx.js`'s `module.exports`
   (`bot_cx.js:514-524`) lists `fbJob`, `config`, `iPhone12`, `profileKey`,
   `normalizeName`, `cookieStringToObj`, `readCookie`, `wait`, `random` — the device
   profile, the pure helpers, and the shared config, but nothing that implies the bot is
   already running.
3. **The consumer destructures only what it needs.** `get_friends.js` does
   `const { config, iPhone12, profileKey, cookieStringToObj, readCookie, wait } =
   require('./bot_cx.js')` (`get_friends.js:20`) — it does not need `fbJob` or
   `normalizeName`, so it doesn't pull them in.

The payoff is twofold: `get_friends.js` gets the exact same stealth setup, device
profile, and cookie handling as the bot with zero duplication, and every exported helper
is now trivially unit-testable in isolation (`require('./bot_cx.js')` from a test file
would work exactly like `get_friends.js` does) without any further refactor. Follow this
same guard-plus-export shape for any future script that needs to share code with
`bot_cx.js` — do not copy-paste the stealth/device-profile setup into a new file.

## Standalone script over in-bot step, for anything DOM-fragile

`get_friends.js` used to be a method (`scrapeFriends()`) called automatically from
`fbJob.init()`. It was pulled out into its own script for a reason worth generalizing:
**when a piece of functionality depends on external markup that cannot be verified
without a live, logged-in session, keep it out of the main long-running process and make
it a standalone, re-runnable script instead.**

The concrete cost that motivated this: iterating on the in-bot version meant editing a
selector, then restarting the *entire bot* — relaunch Chromium, re-authenticate,
re-navigate the feed — just to learn whether the friend-list scrape improved, on a code
path that only ever ran once per bot startup. That loop is what made the friends-center
scrape slow to fix when it turned out not to work at all against a real account (see
[project-overview-pdr.md#constraints--risks](./project-overview-pdr.md#constraints--risks)).
As a standalone script, the same edit-and-test cycle is `node get_friends.js --debug`,
which starts, scrapes, and exits on its own in seconds.

The general principle for future work: if you're about to add DOM-scraping logic against
markup nobody can inspect ahead of time (because it requires an authenticated session, or
any other reason it can't be fixture-tested locally), default to a standalone script that
`require`s shared helpers via the [module boundary convention](#module-boundary-convention)
above, rather than wiring it into the bot's own startup or task loop. Reserve in-bot steps
for logic that's already been verified to work.

## Diagnostics convention

Because the friends-list DOM can't be verified locally, `get_friends.js` is written to
**self-report enough structure to be debugged remotely** whenever a scrape comes up
short — the operator should never need to paste raw HTML or share their screen to get a
selector fixed. `diagnose()` (`get_friends.js:75-98`) is the reference implementation:
given every harvested `{href}`, it prints the total link count, the 25 most common URL
pathnames with counts, and up to 25 sample hrefs that got rejected by `profileKey`. It
runs automatically whenever a scrape yields fewer than `MIN_EXPECTED` profiles (not only
under `--debug`), and `scrapeFrom()` also dumps `debug_friends.html` at the same moment
(`get_friends.js:160-164`) so there's a full-fidelity fallback if the summary isn't
enough.

Apply this same convention to any future scraping logic added against markup that can't
be verified locally: don't just fail or log "0 results" — print a structural summary
(counts grouped by some discriminating property, plus a bounded sample of what got
rejected and why) so the person who *can* see the live page has something concrete to act
on without a live debugging session.

## Don't destroy user-curated data without an explicit override flag

`get_friends.js` writes `friends.json` unattended, but an operator may have hand-pruned
that same file after a previous scrape (removing "Những người bạn có thể biết" strangers,
per [Diagnostics convention](#diagnostics-convention) above and the risk entry in
[project-overview-pdr.md](./project-overview-pdr.md#constraints--risks)) and marked it
`"manual": true` to say so. A plain rescan used to overwrite that hand-edited file
unconditionally — silently destroying curation work the moment the operator reran `npm
run friends` for any reason (a new friend, habit, muscle memory). It now doesn't:

- Before writing, the shared `save()` helper reads any existing `friends.json`
  (`get_friends.js:171-185`) and, if it parses **and** `manual === true`, refuses to
  overwrite: it prints how many profiles were just acquired, states plainly that nothing
  was saved, and points at the `--force` flag, then sets a non-zero exit code — a normal
  run looks like a no-op, not a silent failure. Because both acquisition paths call
  `save()` (see [Extract shared logic when a second input source
  appears](#extract-shared-logic-when-a-second-input-source-appears) below), the guard
  protects hand-edited data the same way regardless of whether the next run is a live
  scrape or `--from-html`.
- `--force` (`get_friends.js:24`) is the explicit, opt-in override. There is no implicit
  or auto-detected way to bypass the guard.
- A file that exists but fails to parse (corrupt JSON) is deliberately **not** treated as
  protected — `get_friends.js` warns and overwrites it, because a corrupt file blocking
  every future rescan forever would be worse than losing a broken file's contents. The
  guard protects *curated* data, not just *any* pre-existing file.

Generalize this for any future write path in this codebase that can clobber something a
human may have hand-edited: default to refusing, say clearly what would have been
written and why it wasn't, and require an explicit flag (not a prompt — there's no
interactive terminal to assume, and not a config toggle that could be left on by
accident) to proceed anyway. Treat "the file is there but unreadable" as a different case
from "the file is there and says don't touch me" — only the latter should block the
write.

## Extract shared logic when a second input source appears

`get_friends.js` originally had exactly one way to get link data (the live browser
scrape), so the dedupe-and-collect step lived inline inside `scrapeFrom()`. Adding
`--from-html` — a second source of the same `[{href, text}]` shape, from
`parseHtmlFile()` — is what triggered pulling that step out into the standalone
`collect(links)` helper (`get_friends.js:101-119`), rather than copy-pasting the same
loop into the new function. The same thing happened to the `"manual": true` overwrite
guard: once both sources needed to write `friends.json` through the identical check, it
came out of the (then-single) write call site and became `save(result)`
(`get_friends.js:170-199`), called from both branches of the IIFE main.

The rule of thumb this reflects: **duplicating a piece of logic once (two call sites) is
fine — reaching for the extraction the moment a second call site appears is not premature
abstraction here, because the two source-vs-source and write-path invariants (dedupe by
`profileKey`, respect `manual: true`) have to stay identical or the two acquisition paths
silently drift apart.** Don't extract speculatively ahead of a second call site — `collect`
and `save` didn't exist until `--from-html` actually needed them — but don't leave the
duplication in place once it does, either.

## Match by stable id, not display name

The core design decision behind friends-only filtering
(`profileKey`, `bot_cx.js:90-113`) is matching a post's author against the friend list
by a **stable identity** — a numeric Facebook id (from `/profile.php?id=N`) or a
username path segment — rather than by the person's display name. Display names have
diacritics, duplicates, and change over time; two different people can share a name,
and the same person's name can be entered or rendered slightly differently in different
contexts. An id or username is far closer to a primary key.

The one place this project deliberately falls back to name matching is the Facebook
"Download Your Information" export path (`friends_v2` in `friends.json`, handled in
`loadFriends()`, `bot_cx.js:229-233`), because that export format doesn't include
profile ids at all. `normalizeName()` (`bot_cx.js:115-118`) exists specifically to make
that fallback as consistent as practical (NFC normalization + lowercase + whitespace
collapse), but it is still explicitly documented as the weaker path — see the risk entry
in
[project-overview-pdr.md#constraints--risks](./project-overview-pdr.md#constraints--risks).
If you add any other place that needs to compare "is this the same person," prefer a
stable id over a name if one is available at all, and if you must fall back to a name,
route it through `normalizeName()` rather than inventing another ad-hoc string
comparison.

## Prefer DOM-order/structural heuristics over CSS class selectors

`getPostAuthor()` (`bot_cx.js:269-279`) identifies a post's author by walking every
`a[href]` inside the post's markup **in DOM order** and returning the first one whose
`href` resolves through `profileKey()` to a profile — not by matching a specific CSS
class or `data-*` attribute on the author link. The reasoning: Facebook's mobile web
markup is unversioned and its class names/component wrappers change without notice
(this is the same fragility already documented for the like-button and post-container
selectors in
[codebase-summary.md#dom-selectors-the-bot-depends-on](./codebase-summary.md#dom-selectors-the-bot-depends-on)).
A structural assumption — "the first profile-shaped link in a post is the header
author" — is more likely to keep working across a markup refresh than a specific class
name is, because it depends on *where* something is rather than *what it's labeled*.
`get_friends.js`'s `scrapeFrom()` uses the same style of heuristic: it harvests every
`a[href]` on whichever friends-list page it's trying (`get_friends.js:151-155`) rather
than targeting one specific class.

This is a preference, not an absolute rule — the existing like-button/already-liked
selectors still target specific attributes because there wasn't a comparably reliable
structural signal available for them. When adding new scraping logic against Facebook
markup, reach for a DOM-order or structural heuristic first, and fall back to a specific
selector only when no such heuristic is available.

## Verify-before-trust workflow

`config.verifyMode` (default `true`) makes `findPostAndLike()` log every scanned post's
detected author and whether it matched a friend
(`bot_cx.js:326-331`, e.g. `  tác giả: 100012345678901 (Nguyễn Văn A) ✓ bạn bè`), before
any like is attempted. The intended workflow for anyone changing the friends-matching
logic, the friend-list scrape, or anything else that gates which posts get liked:

1. Leave `verifyMode: true` (the default) after making the change.
2. Run the bot and read the per-post log lines for a few scan cycles — confirm authors
   are being extracted at all (not `không xác định`), and that the friend/not-friend
   verdicts look right against what you know about the account's actual friends.
3. Only once you've watched it behave correctly, consider setting `verifyMode: false`
   for quieter logs during long unattended runs.

This same principle applies to the friend-list scrape itself: `get_friends.js` always
prints the resulting friend count and a warning to manually check `friends.json` before
trusting it (`get_friends.js:192-197`) — because a scrape that picked up "Những người bạn
có thể biết" (People You May Know) strangers would otherwise fail silently as "it liked
some posts," not as a visible error. It goes one step further than the bot's own
`verifyMode`: since the friends-list DOM can't be watched live by anyone but the
operator, `get_friends.js` also self-reports structure whenever a scrape looks wrong —
see [Diagnostics convention](#diagnostics-convention) above. Any new heuristic-based
filtering added to this codebase should ship with a similar way to observe it working
before an operator walks away and lets it run unattended.

## Error handling — current state and what to change

- `fbPage.on('error', ...)` and `fbPage.on('pageerror', ...)` (`bot_cx.js:178-184`) are
  registered with **empty handler bodies** (the `console.error` calls inside them are
  commented out). This means in-page JS errors and page crash events are silently
  swallowed today — the bot has no visibility into them at all.
  - **Standard for new code**: do not add another silent handler. If you touch this
    area, at minimum log the error (respecting the existing convention of keeping
    routine/expected noise off by default, e.g. behind a flag), rather than leaving the
    handler empty.
- The one real `try/catch` in the like pipeline wraps the click attempt in
  `findPostAndLike()` (`bot_cx.js:386-399`): on failure it logs
  `'Like lỗi', likeTarget, e.message` and lets the surrounding `while` loop retry a
  different candidate. `get_friends.js`'s main loop follows the same pattern around each
  page-interaction attempt (`get_friends.js:227-234`): catch narrowly around
  `scrapeFrom(page, url)`, log `e.message`, and move on to the next `FRIEND_URLS`
  candidate rather than letting one bad URL abort the whole run. This is the pattern to
  follow for any new page-interaction call that might reasonably fail mid-run (a stale
  element, a navigation that raced the click, an unexpected redirect, etc.) — catch
  narrowly around the interaction, log enough to diagnose, and let the caller decide
  whether to retry or move on.
- The empty-friend-list case in `init()` (`bot_cx.js:192-197`) is a deliberate exception
  to "log and continue": rather than starting the task loop with a filter that can never
  match anything, it prints an explanation and calls `process.exit(1)`. Prefer a loud,
  explained exit over a mode that runs forever doing nothing when a required precondition
  isn't met.
- **`process.exit(1)` vs `process.exit(0)` — get this right, it's part of the contract
  with whatever runs this process (a shell script, PM2, a human reading `$?`).** The
  `readCookie()` helper (`bot_cx.js:496-503`) is a concrete example of getting it fixed:
  it used to call `process.exit(0)` when `cookie.txt` was missing, which reports
  **success** to anything checking the exit code even though startup actually failed. It
  now calls `process.exit(1)`. Use `0` only for an intentional, successful stop; use a
  non-zero code (`1` is fine; this codebase doesn't need a richer code scheme) for any
  exit that means "something the operator needs to fix is wrong" — a missing file, an
  empty required data set, an unhandled precondition. `get_friends.js`'s own failure exit
  (`process.exitCode = 1`, set when no `FRIEND_URLS` candidate yields any profiles)
  follows the same rule.
- Everything else is **unhandled by design** — there is no top-level
  `process.on('unhandledRejection', ...)` or `uncaughtException` handler. An unexpected
  throw anywhere outside the `try/catch`es above will crash the process, and because
  `ecosystem.config.js` sets `autorestart: false`, PM2 will not bring it back
  automatically. Do not add broad top-level catch-and-continue handlers without also
  addressing the `autorestart` question — silently swallowing a crash and continuing in
  a bad state is worse than a visible stop. See
  [system-architecture.md#pm2](./system-architecture.md#pm2).

## Secret handling

- `cookie.txt` holds a live Facebook session cookie — treat it as equivalent to a
  password. It is already listed in `.gitignore`; **never** remove it from there, and
  never commit an actual cookie value even temporarily (including in a commit that's
  later reverted — git history retains it).
- `cookie.txt.example` must stay an empty (or clearly fake) placeholder. Do not commit a
  real-looking sample cookie into it.
- `friends.json` and the optional `debug_post.html`/`debug_friends.html` dumps are
  personal data (a friend list, or raw scraped page HTML) rather than credentials, but
  are gitignored for the same reason: they identify real people and should not end up in
  a public git history. Keep them gitignored; if you add a `.example` counterpart for
  discoverability, keep it a synthetic/fake sample, not a real export.
- If you add any other credential/token in the future, follow the same pattern: a
  gitignored file (or an environment variable) for the real value, an empty/fake
  `.example` counterpart committed for discoverability, and a `.gitignore` entry added
  in the same change that introduces the file.
- Do not log the raw cookie string. Today's code never does.

## Naming

- Variables and functions: `camelCase` (`cookieStringToObj`, `fbPage`, `taskInterval`,
  `getPostAuthor`, `isFriend`).
- Module-level constants that are frozen/never reassigned (`config`, `iPhone12`,
  `NON_PROFILE_PATHS`, `taskTypes`) use `camelCase` except `NON_PROFILE_PATHS`, which
  uses `SCREAMING_SNAKE_CASE` as a `Set` of string literals — follow whichever of these
  two styles matches the shape of what you're adding (a config-like object → camelCase,
  a fixed lookup set of literal strings → SCREAMING_SNAKE_CASE), consistent with the two
  precedents already in the file.
- The one class: `PascalCase`... actually `fbJob` is lowercase-led, which breaks
  conventional PascalCase class naming. If you add further classes, prefer standard
  `PascalCase` (e.g. `FbJob`) for new code even though the existing class does not
  follow it — do not "fix" the existing name in an otherwise-unrelated change, since
  renaming the sole exported/used class has no functional benefit and only adds diff
  noise for a single-file project with no external consumers.
- Enum values: lowercase string literals (`'scroll'`, `'like'`, `'wait'`) matching the
  enum key's lowercase form.

## How to add a new task type to the queue

This is the most likely extension point, so it's worth spelling out the steps using the
existing pattern (see [system-architecture.md#task-queue-design](./system-architecture.md#task-queue-design)
for the surrounding design):

1. Add the new key to the frozen `taskTypes` object (`bot_cx.js:120-124`), e.g.
   `COMMENT: 'comment'`.
2. Decide who produces it: either add it to the batch the producer builds every empty-queue
   tick (`bot_cx.js:418-442`), or push it from elsewhere (e.g. conditionally, like the
   WAIT task's ~1/13 chance).
3. Add a `case taskTypes.YOUR_TYPE:` branch in the `switch` inside `handleTask()`
   (`bot_cx.js:461-474`) that `await`s an `fbJob` method implementing the behavior.
4. Implement that method as an `fbJob` instance method (not a standalone function),
   using `wait()`/`random()` for any pacing, and wrap any Puppeteer interaction that can
   throw in a narrow `try/catch` per the pattern above.
5. If the new task type can determine "nothing more to do," don't automatically copy the
   full teardown-and-restart pattern (`bot_cx.js:362-371`). Follow `findPostAndLike`'s
   current design instead: track a per-condition counter (like `emptyScans`), retry with
   some incremental recovery action (like scrolling) below a threshold, and only escalate
   to a full session restart after sustained, not single, failure — see
   [system-architecture.md#process-lifecycle--state-machine](./system-architecture.md#process-lifecycle--state-machine).
6. If any tunable your new task type needs is a policy/threshold an operator might want
   to change, add it to the `config` block (`bot_cx.js:11-30`) rather than hardcoding it
   — see [Config block convention](#config-block-convention) above.
7. Update the table in
   [codebase-summary.md#functions-and-methods-bot_cxjs](./codebase-summary.md#functions-and-methods-bot_cxjs)
   and, if it introduces new DOM selectors, the selector table in the same document —
   documentation and code should change in the same commit.

## Testing

There is currently no committed test suite (`npm test` is a placeholder,
`package.json:6`) and no test framework dependency. During development of the
friends-only feature, the new pure-logic pieces were exercised with **ad-hoc scratch
scripts** (not committed to the repo):

- `profileKey()` was checked against 17 real-world `href` shapes (profile.php ids,
  username paths, group/watch/reel/marketplace/etc. non-profile paths, non-facebook
  hosts) — 17/17 passed.
- `getPostAuthor()` + `isFriend()` were checked against 8 mock post HTML fixtures —
  friend-by-id, friend-by-username, friend-by-DYI-name, suggested stranger, followed
  page, group post by a stranger, group post by a friend, and a reel — 8/8 passed. The
  group-post-by-friend fixture is what confirmed the deliberate "filter is per-author,
  not per-surface" behavior described in
  [system-architecture.md#like-pipeline-data-flow](./system-architecture.md#like-pipeline-data-flow).

These results are recorded here for traceability, but they are **not** a substitute for
a committed test suite — there is nothing in CI or in the repo that re-runs them, and
the next person touching `profileKey`/`getPostAuthor`/`isFriend` has no automated
guardrail. If tests are introduced going forward:

- Pure helpers (`random`, `wait`, `cookieStringToObj`, `profileKey`, `normalizeName`)
  are the easiest targets — they have no Puppeteer dependency and can be unit tested
  directly. `profileKey` and `normalizeName` are the highest-value first candidates
  given they already have informal fixtures to draw on (see above). Now that `bot_cx.js`
  has an explicit `module.exports` (`bot_cx.js:514-524` — see
  [Module boundary convention](#module-boundary-convention) above), a test file could
  `require('./bot_cx.js')` for these exactly the way `get_friends.js` does, with no
  further refactor needed to make them reachable.
- Anything touching `fbPage`/`browser` needs either a real headless Chromium instance in
  CI or a mocking layer around Puppeteer; neither exists today, so introducing tests for
  `findPostAndLike`, `init`, or `get_friends.js`'s `scrapeFrom`/`expandList`, is a larger
  undertaking than adding unit tests for the helpers.
- This is tracked as a known gap in
  [project-overview-pdr.md#known-gaps--roadmap](./project-overview-pdr.md#known-gaps--roadmap),
  not something this documentation pass fixes.
