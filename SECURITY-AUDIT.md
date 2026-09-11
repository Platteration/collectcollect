# collectcollect — security audit (2026-09-11)

A dedicated security pass, separate from and later than the review in `REVIEW.md`. Specialist reviewers read the repository through 3 independent lenses (L1, L2, L3), each required to *demonstrate* a finding rather than argue for it.

**12 findings** — 2 high, 5 medium, 5 low. Every one was reproduced with command output rather than argued from reading.

## Status

Every finding below was fixed on `claude/repo-review-security-baiyud` in c82d8f5, each with a regression test that was checked by reverting the fix and confirming the test fails. The findings are kept as written so the reasoning behind each change stays with it.

## Findings

### L1-1 · high — Every enum whitelist is an `in`/bare-index lookup, so `__proto__` passes validation and one POST permanently 500s every page

`src/lib/cards.ts`:133 · CWE-1321 · reproduced

**Who.** Anyone who can reach the port. The README documents APP_PASSWORD as optional and `authEnabled()` fails open when it is unset, so on the default configuration (and on the compose file's 0.0.0.0:3000 publish) this is any host on the LAN. It is also reachable by whoever supplies a backup archive the owner restores (see L1-2), and by anyone who can get a row into the cards table by any route.

**How.** 1. POST /api/cards with {"game":"__proto__","name":"x"} (no auth, no CSRF token needed for a non-browser client). 2. normalizeInput checks `game in GAMES`; `in` walks the prototype chain, so `__proto__` (and `constructor`, `toString`, `valueOf`, `hasOwnProperty`, …) are all reported as valid games. The row is written to SQLite. 3. Every server-rendered page that shows a card renders `{GAMES[card.game]}`. `GAMES["__proto__"]` is Object.prototype, and React throws `Objects are not valid as a React child` on an object child. 4. The portfolio (/), /collection, /cards/<id> and /report now return HTTP 500 on every request, for every visitor, forever — the value is persisted. The same holds for `condition` (`CONDITIONS[c.condition]`), `gradingStatus` (`GRADING_STATUSES[...]`, which rowToCard re-admits with the same `in` check at cards.ts:88) and submission `status` (submissions.ts:68 → SUBMISSION_STATUSES[...] in SubmissionDetail.tsx:78).

**Why it matters.** Persistent denial of service of the entire web UI from a single unauthenticated request. The JSON API still answers, so an owner who knows the row id can DELETE it, but nothing in the product tells them that — every page they would use to find the card is dead. Chained with L1-2 (restore path) there is no in-app recovery at all. The repo's sibling projects record this exact rule ("Whitelists are own-property lookups (has(TABLE, id)), never a bare TABLE[id]: every name on Object.prototype — constructor, __proto__, toString — is truthy on a plain table and used to pass as a valid style, mood or mode"); this repo violates it in 15 places.

**Evidence.**

src/lib/cards.ts:133  `if (!game || !(game in GAMES)) throw new Error(...)`
src/lib/cards.ts:137  `if (!(condition in CONDITIONS)) throw ...`
src/lib/cards.ts:140  `if (!(gradingStatus in GRADING_STATUSES)) throw ...`
src/lib/cards.ts:88   `gradingStatus: (row.grading_status in GRADING_STATUSES ? row.grading_status : "undecided")`
src/lib/submissions.ts:68 `status: (r.status in SUBMISSION_STATUSES ? r.status : "draft")`
src/lib/import.ts:137 `GAME_ALIASES[rawGame] ?? ... (rawGame in GAMES ...)`
src/lib/import.ts:150 `CONDITION_ALIASES[conditionText] ?? (conditionText.toUpperCase() in CONDITIONS ...)`
src/lib/images.ts:67  `if (!ALLOWED_IMAGE_TYPES[file.type])`  (see L1-5)
src/app/api/cards/route.ts:11,19 · src/app/api/prices/lookup/route.ts:19,33 · src/app/api/sets/refresh/route.ts:15 · src/app/api/import/route.ts:26 · src/app/collection/page.tsx:12 · src/app/sets/[game]/[name]/page.tsx:12
Render sinks: src/components/CardTile.tsx:22 `{GAMES[card.game]}` · CardDetail.tsx:205 · Portfolio.tsx:291,297,333 · CollectionGrid.tsx:106 · SetsList.tsx:48 · SubmissionDetail.tsx:78,198 · src/app/report/page.tsx:94 · src/app/submissions/page.tsx:73

Measured against a running `next dev` (DATA_DIR pointed at a scratch directory):

  --- baseline ---
  /            -> 200
  /collection  -> 200
  --- POST game=__proto__ ---
  create=201
  /            -> 500
  /collection  -> 500
  /report      -> 500

Server log:
  Functions are not valid as a React child. ...
  ⨯ Error: Objects are not valid as a React child (found: object with keys {}). ...
   GET /collection 500 in 1031ms

`condition` and `gradingStatus` are accepted the same way:
  POST {"game":"pokemon","name":"y","condition":"__proto__","gradingStatus":"toString"}
  -> 201 {"card":{... "condition":"__proto__" ...}}

This is not dev-only: the production server renderer throws on the same path —
  node_modules/react-dom/cjs/react-dom-server.node.production.js:5543-5547
    childIndex = Object.prototype.toString.call(node);
    throw Error("Objects are not valid as a React child (found: " + ...

**Fix.** Replace every `key in TABLE` membership test and every bare `TABLE[key]` keyed on outside data with an own-property check. Concretely: add `const has = (t: object, k: string) => Object.prototype.hasOwnProperty.call(t, k)` (or build the tables with `Object.create(null)`, or keep `GAME_IDS`/`Object.keys(CONDITIONS)` Sets and test membership with `.has()`), then use it at src/lib/cards.ts:88,133,137,140; src/lib/submissions.ts:68; src/lib/import.ts:137,150 (GAME_ALIASES/CONDITION_ALIASES are bare lookups too); src/lib/images.ts:67; src/app/api/cards/route.ts:11,19; src/app/api/prices/lookup/route.ts:19,33; src/app/api/sets/refresh/route.ts:15; src/app/api/import/route.ts:26; src/app/collection/page.tsx:12; src/app/sets/[game]/[name]/page.tsx:12. Belt and braces at the render sinks: make the lookups return a string fallback, e.g. `GAMES[card.game] ?? card.game` guarded by the same `has()`, so a row that predates the fix cannot throw. Add a test that POSTs each of `__proto__`, `constructor`, `toString`, `valueOf` as game/condition/gradingStatus and asserts a 400, and one that renders CardTile with `game: "__proto__"` without throwing.


### L1-2 · high — Restore installs an attacker-supplied SQLite database whose rows are never validated, and snapshot/checklist JSON is parsed unguarded — a 12 KB archive bricks every page and the cards API

`src/lib/backup.ts`:190 · CWE-502 · reproduced

**Who.** Whoever writes the backup file: someone who sends the owner a .zip to "restore my collection into yours", or — in the default no-password configuration — anyone who can reach the port and POST /api/backup/restore directly (the archive only has to be a few kilobytes, so the 10 MB truncation in L1-4 does not get in the way).

**How.** 1. Build a SQLite file with the app's `cards` and `price_snapshots` schema, one ordinary-looking card, and one price_snapshots row whose `summary` column is the single character `{`. 2. Pack it as `collectcollect.db` in a zip alongside a `manifest.json`. 3. POST it to /api/backup/restore. restoreBackup validates only the entry *names* and then, as its sole check on the database, opens it and runs `SELECT COUNT(*) FROM cards` — it never looks at a single row. It copies the file over the live database. 4. Every page that prices a card calls listSnapshots/allSnapshots/latestSnapshotsByCard, which do a bare `JSON.parse(r.summary)` with no try/catch (unlike rowToCard, which routes card JSON through `parseJson`). The parse throws and nothing catches it: there is no error boundary. 5. /, /collection, /report, /cards/<id> AND /api/cards all return 500. The same works through `set_checklists.cards` (src/lib/sets/index.ts:46,54). Separately, the same archive can set `game`, `condition`, `grading_status`, `accent_color`, `image_path` and `reference_image_url` to anything at all, which is the second vector for L1-1.

**Why it matters.** Total, persistent denial of service with no recovery path inside the product: unlike L1-1 the JSON API is dead too, so the owner cannot list or delete the offending row without a shell and the sqlite3 binary. The same archive also silently replaces the entire collection (the old one is moved aside, so it is recoverable by hand, but the app will not come up to say so). The restore path is the one place in this app that consumes a whole file written by someone else and installs it as the app's own state; it does less validation than POST /api/cards does.

**Evidence.**

src/lib/backup.ts:189-196 — the entire check on the archive's database:
    const check = openDatabase(stagedDb);
    cards = (check.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
    check.close();
src/lib/backup.ts:234 `await fsp.copyFile(stagedDb, live);`
src/lib/cards.ts:367  `summary: JSON.parse(r.summary) as PriceSummary,`   (listSnapshots)
src/lib/cards.ts:384  `summary: JSON.parse(r.summary) as PriceSummary,`   (allSnapshots)
src/lib/cards.ts:403  `summary: JSON.parse(r.summary) as PriceSummary,`   (latestSnapshotsByCard)
src/lib/sets/index.ts:46,54 `cards: JSON.parse(row.cards),`
contrast src/lib/cards.ts:50-57 `function parseJson<T>(text, fallback) { try { return JSON.parse(text) } catch { return fallback } }` — used for every card column, none of the snapshot ones.

Run against a live server:
  $ node mkdb2.cjs snap.db      # one card, one snapshot row with summary = '{'
  $ curl -s -X POST -F archive=@snap.zip http://127.0.0.1:3518/api/backup/restore
  {"result":{"photos":0,"cards":1,"movedAsideTo":".../replaced-2026-09-11T13-17-34-097Z"}}
  /              -> 500
  /collection    -> 500
  /report        -> 500
  /api/cards     -> 500
  /cards/1       -> 500

And with the row-poisoning variant (game='__proto__', accent_color and image_path arbitrary), the same 12 KB archive restores cleanly and leaves /collection, /report and /cards/1 at 500.

**Fix.** Two changes, both small. (a) Route every snapshot and checklist parse through the existing `parseJson` helper and drop rows that do not parse: src/lib/cards.ts:367,384,403 and src/lib/sets/index.ts:46,54 — `const summary = parseJson<PriceSummary | null>(r.summary, null); if (!summary) continue;`. Add a test that inserts `summary = '{'` and asserts the portfolio still renders. (b) Make restoreBackup validate the rows it is about to install, not just the file: after `openDatabase(stagedDb)`, run the staged database's cards through the same `rowToCard`/`normalizeInput` pass the write path uses (or at minimum assert `game`, `condition` and `grading_status` are own keys of their tables, `accent_color` matches /^#[0-9a-f]{6}$/i, `image_path` passes isValidUploadName, `reference_image_url` passes httpUrl, `identification`/`external_ids`/`manual_graded`/`summary` parse as JSON) and refuse the archive with a specific message rather than installing it. Doing it on the staging copy, before anything is moved aside, costs one extra pass over a file that is already in memory.


### L1-3 · medium — CSV import is a single-request, unauthenticated, whole-server freeze: 500 KB of CSV blocked the process for 60 seconds

`src/lib/import.ts`:193 · CWE-1333 · reproduced

**Who.** Anyone who can reach the port (default configuration has no password). One HTTP request, no session, no file upload — a JSON body.

**How.** 1. POST /api/import with {"csv": "<N rows>", "apply": true}. 2. applyImport loops over every row and calls intakeCard, which opens a better-sqlite3 transaction and calls findSimilar. 3. findSimilar's WHERE clause is `lower(trim(name)) = ?`, an expression with no supporting index (src/lib/db.ts declares indexes only on price_snapshots, sales, submission_cards and alerts), so SQLite full-scans the cards table once per imported row — over a table that the import itself is growing. 4. better-sqlite3 is synchronous and this runs inside the request handler, so the Node event loop is blocked for the whole import: the server answers nothing else. 5. There is no row cap anywhere; the effective ceiling is whatever CSV fits in a request body.

**Why it matters.** Complete unavailability of the app for the duration, from one request. Measured: 20 000 rows (≈500 KB of CSV) blocked the process for 59 s, and a GET /api/alerts issued 3 s into the import did not return for 60 s. The cost is quadratic in rows, and it is cumulative — the table keeps the rows, so each subsequent import is slower. A body at the effective 10 MB ceiling (~330 000 rows) extrapolates from the measured curve to hours of a frozen server, and leaves a permanently degraded database behind. One dev server died outright during a repeat run.

**Evidence.**

src/lib/import.ts:193-210 `export function applyImport(preview: ImportPreview): ImportResult { ... for (const row of preview.rows) { ... const outcome = intakeCard(row.input); ... } }` — no row cap, no batching, no single enclosing transaction.
src/lib/cards.ts:236-238 `getDb().prepare("SELECT * FROM cards WHERE game = ? AND lower(trim(name)) = ? ORDER BY updated_at DESC").all(...)` — the expression defeats any index on cards(name).
src/app/api/import/route.ts:30 `return NextResponse.json({ preview, result: applyImport(preview) });`

Measured on a clean database (each request against a table already grown by the previous one):
  2500 rows (71 KB body)  ->  1898 ms, created 2500
  5000 rows (144 KB body) ->  6134 ms, created 5000
  10000 rows (301 KB body)-> 23312 ms, created 10000

Separate run, 20 000 rows from empty, with a concurrent health check:
  import status 200 in 59338 ms
    concurrent GET /api/alerts: 200 60249 ms      <-- queued behind the blocked event loop
  server log:  POST /api/import 200 in 61s (application-code: 60s)

This is REVIEW.md's MISS-2, which is listed as a finding but is not in the fixed list and has not been fixed; the measurement above is new and puts the impact above the "Low" it was filed at.

**Fix.** Three parts, all in the review's original recommendation and still unapplied: (1) cap previewImport at a few thousand rows and report the number skipped, so a pathological file is refused rather than run; (2) add a stored normalised-name column written by createCard/updateCard (`name_key = lower(trim(name))`) plus `CREATE INDEX idx_cards_lookup ON cards(game, name_key)`, and have findSimilar match on it — that turns the per-row full scan into an index probe; (3) wrap applyImport's whole loop in one `getDb().transaction(...)` so the import is one fsync rather than N. A test that imports 5 000 rows and asserts it completes in a low number of seconds pins all three.


### L1-4 · medium — Adding proxy.ts silently capped every request body at 10 MB, so restore of any real backup fails and the 512 MB / 25 MB size limits are unreachable

`next.config.ts`:31 · CWE-754 · reproduced

**Who.** No external attacker — this is an availability and integrity defect in the recovery path, reported because it is the remedy for L1-1 and L1-2 and it does not work. It is self-inflicted: commit 47f5ce5 ("Close CSRF, DNS rebinding and unmetered spend on the API routes") introduced src/proxy.ts, and Next 16 buffers the body of every proxied request.

**How.** 1. The owner (or a hostile archive, per L1-2) leaves the collection in a state that needs restoring. 2. They upload their real backup — any collection with photos is comfortably over 10 MB. 3. Next buffers only the first 10 MB, logs a warning to the server console, and per its own documentation "the request will not fail or return an error to the client" — the route handler receives a truncated body. 4. request.formData() cannot find the closing multipart boundary, so POST /api/backup/restore answers 400 "Expected multipart/form-data with an archive" — a message that points at the wrong problem entirely. The same applies to /api/uploads: MAX_BYTES is 25 MB per file and MAX_TOTAL_BYTES 500 MB, but any request over 10 MB dies as "Expected multipart/form-data".

**Why it matters.** The documented disaster-recovery path (Settings → Restore from backup) is non-functional for any collection over 10 MB, and fails with a message that reads as "your file is the wrong type". The owner will not discover this until the moment they need it. Every size ceiling the code enforces — RESTORE_MAX_BYTES (512 MB), MAX_BYTES (25 MB/file), MAX_TOTAL_BYTES (500 MB), and the declaredTooLarge() pre-checks added for REVIEW.md's SEC-4 — is dead code above 10 MB. A large photo upload is likewise refused rather than stored.

**Evidence.**

node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md:
  "When proxy is used, Next.js automatically clones the request body and buffers it in memory ... By default, the maximum body size is 10MB. If a request body exceeds this limit, the body will only be buffered up to the limit, and a warning will be logged" ... "The request will not fail or return an error to the client".
src/proxy.ts:101 `export async function proxy(request: NextRequest)` — exists, so the buffering applies to every route.
next.config.ts — no `experimental.proxyClientMaxBodySize`.
src/lib/backup.ts:147 `export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;`
src/app/api/uploads/route.ts:5-8 `MAX_FILES = 20; MAX_BYTES = 25 * 1024 * 1024; MAX_TOTAL_BYTES = MAX_FILES * MAX_BYTES;`

Measured:
  $ node -e 'const big="x".repeat(20*1024*1024); ... fetch("/api/cards", {body: JSON.stringify({game:"pokemon",name:"Big",notes:big})})'
  body bytes: 20971562
  status 400 {"error":"Expected a JSON body"}          <-- JSON truncated at 10 MB

  $ # a 15.7 MB valid backup zip, exactly what buildBackup would produce for a small collection
  $ curl -s -X POST -F archive=@big.zip http://127.0.0.1:3517/api/backup/restore
  {"error":"Expected multipart/form-data with an archive"}

  $ node upl.mjs big.bin image/jpeg        # 15 MB, well under the documented 25 MB per file
  type="image/jpeg" status=400 -> {"error":"Expected multipart/form-data"}

Server log for all three:
  Request body exceeded 10MB for /api/cards. Only the first 10MB will be available unless configured.
  Request body exceeded 10MB for /api/backup/restore. Only the first 10MB will be available unless configured.
  Request body exceeded 10MB for /api/uploads. Only the first 10MB will be available unless configured.

**Fix.** Set `experimental: { proxyClientMaxBodySize: '512mb' }` in next.config.ts to match RESTORE_MAX_BYTES — or, better, lower RESTORE_MAX_BYTES to something a 1-2 GB container can actually hold (64-128 MB, which REVIEW.md's SEC-4 already argued for) and set proxyClientMaxBodySize to the same number, so exactly one value governs. Either way the two must agree, because the app's own limits are unenforceable above whatever the proxy buffer is. Add an e2e case that round-trips a backup larger than the proxy buffer's default (e.g. 12 MB) through GET /api/backup and POST /api/backup/restore and asserts the card count comes back — the existing e2e/backup.spec.ts evidently uses an archive small enough to slip under 10 MB.


### L2-1 · medium — With TRUST_PROXY set the login limiter keys on the leftmost X-Forwarded-For hop, which the client supplies: lockout is evaded, and the owner's own address can be pinned into lockout

`src/lib/rate-limit.ts`:71 · CWE-807 · reproduced

**Who.** Anyone who can reach the app through the reverse proxy the operator put in front of it (the deployment README recommends for remote access). They control every header they send, including X-Forwarded-For; they have no credentials.

**How.** 1. Operator sets APP_PASSWORD and, following .env.example, TRUST_PROXY=1 because a reverse proxy is in front. 2. Every mainstream proxy APPENDS the peer address rather than rewriting the header — nginx's canonical `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, and Caddy's reverse_proxy default — so what arrives is `<whatever the client typed>, <real client address>`. clientKey() takes `split(",")[0]`, i.e. the attacker's own text. 3. To evade the 8-failure lockout the attacker sends a different first hop on each guess; every guess opens a fresh bucket and none is ever refused. 4. To lock the OWNER out instead, the attacker sends the owner's address as the first hop eight times; the owner's genuine requests (whose chain is just their own address) land in that now-blocked bucket and their correct password is refused with 429. 5. The first hop is never validated as an address, so any string mints a bucket.

**Why it matters.** The per-key lockout is decoration: the brute-force budget rises from 8 guesses per 15 minutes (768/day) to the process-wide ceiling of 50 per 15 minutes (4,800/day), a 6.25x increase against a single shared password with no complexity requirement. Separately, an unauthenticated attacker can deny the owner access to their own collection for 15 minutes at a time, repeatable indefinitely, by naming the owner's address — and the owner cannot clear it, because clearLoginFailures only runs on a login that succeeds.

**Evidence.**

src/lib/rate-limit.ts:71-78
  export function clientKey(request: Request): string {
    if (process.env.TRUST_PROXY) {
      const forwarded = request.headers.get("x-forwarded-for");
      const first = forwarded ? forwarded.split(",")[0].trim() : "";
      if (first) return first;
    }
    return "local";
  }
src/app/api/auth/route.ts:11-14 — `const key = clientKey(request); if (loginBlocked(key)) return jsonError("Too many failed attempts. Try again later.", 429);` runs BEFORE the password is checked, so a blocked key is refused even with the correct password.

Live run against `next start` on :3314 with APP_PASSWORD=e2e-secret TRUST_PROXY=1 (198.51.100.9 stands in for the owner, 203.0.113.5 for the attacker; the trailing hop is what the proxy would have appended):

  === A. owner's correct password, before the attack ===
  owner's correct password, before the attack: 200

  === B. attacker pins the VICTIM's key into lockout ===
      attacker sends: X-Forwarded-For: 198.51.100.9, 203.0.113.5
  401 401 401 401 401 401 401 401
  owner's CORRECT password now: 429   <- locked out by someone else

  === C. the same attacker keeps guessing, evading the lockout they just caused ===
  401 401 401 401 401 401 401 401 401 401 401 401
     (12 more guesses, none refused: per-key cap of 8 is meaningless)

  further guesses accepted before the process-wide ceiling: 30   refused: 30
  owner with the CORRECT password once the ceiling is hit: 429

(8 + 12 + 30 = 50 failures in the window, exactly LOGIN_GLOBAL_MAX_ATTEMPTS, and the ceiling then refuses the owner too.)

No address validation, shown by calling the real clientKey with TRUST_PROXY=1:
  "198.51.100.9, 203.0.113.5"        -> bucket "198.51.100.9"
  "not-an-address, 203.0.113.5"      -> bucket "not-an-address"

Scope note: clientKey is used by exactly one caller, src/app/api/auth/route.ts:11. The four spend limiters (identify, prices-refresh, card-price, sets-refresh) pass fixed literal bucket names to rateLimit(), so they are process-wide and are NOT affected by this header.

**Fix.** Read the chain from the RIGHT, not the left, and validate it. Add a TRUSTED_PROXY_HOPS setting (default 1 when TRUST_PROXY is set) and in clientKey take `entries[entries.length - hops]`; reject the value unless it parses as an IPv4 or IPv6 literal; and when the chain is shorter than `hops` — which means no trusted proxy actually wrote it — return a sentinel such as `"untrusted"` rather than the caller's text or the owner's shared bucket. The sibling repo notenote (src/lib/rate-limit.ts:86-97) already does exactly this and is worth copying. Separately, and independently of the key, remove the lockout's ability to refuse a correct password: in src/app/api/auth/route.ts verify the password FIRST and let a correct one through (clearing both counters), applying loginBlocked only to the failure path — otherwise any key an attacker can name is a way to lock someone out. Restate the .env.example note: 'rewrites' is not what nginx and Caddy do by default.


### L2-2 · medium — With TRUST_PROXY unset (the default) every caller shares one lockout bucket, so eight unauthenticated wrong guesses lock the owner out of their own instance, indefinitely

`src/lib/rate-limit.ts`:78 · CWE-645 · reproduced

**Who.** Anyone who can open the port — the rest of the LAN in the compose deployment (`ports: "3000:3000"` publishes on every interface), or the internet if the instance is exposed. No credentials, no session, no special position on the network.

**How.** 1. Operator sets APP_PASSWORD but leaves TRUST_PROXY unset, which is the default and is what .env.example tells them to do unless a proxy rewrites X-Forwarded-For. clientKey() then returns the constant "local" for every caller, attacker and owner alike. 2. Attacker POSTs eight wrong passwords to /api/auth — the one route the proxy leaves public. 3. recordLoginFailure fills the single "local" bucket to LOGIN_MAX_ATTEMPTS with resetAt = now + 15 min. 4. The owner's own login now hits `loginBlocked("local")` at src/app/api/auth/route.ts:12, which runs before the password is ever compared, and is refused 429 with the correct password. 5. After 15 minutes the window lapses; the attacker sends eight more requests and it starts again. Cost: eight HTTP requests every fifteen minutes, forever.

**Why it matters.** An unauthenticated attacker permanently denies the owner access to their own collection. There is no out-of-band recovery in the app: clearLoginFailures only runs on a login that succeeds, and no login can succeed while the shared bucket is full. The only way back in is to restart the process (the counters are in-memory), which the attacker can immediately undo. This is the default configuration of every password-protected deployment.

**Evidence.**

src/lib/rate-limit.ts:71-78 — `return "local";` for every caller when TRUST_PROXY is unset.
src/lib/rate-limit.ts:81-85 — `loginBlocked` returns true while `record.count >= LOGIN_MAX_ATTEMPTS && now < record.resetAt`.
src/app/api/auth/route.ts:11-14 — the lockout is consulted before the password, so a correct password cannot get through it.

Live run against `next start` on :3311 with APP_PASSWORD=e2e-secret and TRUST_PROXY unset:

  attacker sends 8 wrong guesses, each from a *different* X-Forwarded-For:
  401 401 401 401 401 401 401 401
  owner now tries the CORRECT password: 429
  owner tries again:                    429
  attacker sends one more wrong guess -> 429
  owner again: 429

(The differing X-Forwarded-For values are ignored — that is the point — so all eight land in "local", which is also the owner's bucket.)

Driving the real rate-limit module with a controllable clock shows the cycle is repeatable forever:

  key for attacker w/ XFF 1.2.3.4 : local
  key for the owner, no headers   : local
  round 1: after 8 anonymous wrong guesses -> owner blocked? true
  round 1: 15 min later        -> owner blocked? false
  round 2: after 8 anonymous wrong guesses -> owner blocked? true
  round 2: 15 min later        -> owner blocked? false
  round 3: after 8 anonymous wrong guesses -> owner blocked? true
  round 3: 15 min later        -> owner blocked? false
  cost to the attacker: 8 requests every 15 minutes, forever.

**Fix.** Never let a failure counter refuse a correct password. In src/app/api/auth/route.ts, parse the body and call passwordMatches() first; on success issue the cookie and clear the counters unconditionally. Apply the throttle only to the failure branch, and make it a cost rather than a refusal: keep the per-failure sleep and let it grow with the bucket's count (e.g. `min(250ms * 2**(count-1), 10s)`), so a wrong guess is progressively expensive while a right one always works. Keep the 429 refusal only for a key that is genuinely per-caller — which, given that Next 16's App Router exposes no socket address (there is no request.ip and no documented equivalent; the standalone Docker output cannot use a custom server), means only when TRUST_PROXY plus a correctly-read chain supplies one, per L2-1.


### L2-3 · medium — With APP_SECRET set, changing APP_PASSWORD does not end existing sessions, contrary to the README and to the code's own comment

`src/lib/auth.ts`:73 · CWE-613 · reproduced

**Who.** Whoever holds a copy of a session cookie: someone who used the owner's browser, read it off a shared or borrowed machine, pulled it from a browser-profile backup, or captured it on the wire in the plain-HTTP-behind-a-proxy deployment the README describes (COOKIE_SECURE defaults to off there). The owner notices and changes the password.

**How.** 1. Operator sets APP_SECRET, which .env.example offers as a supported option ('Optional separate signing secret') and the README as 'APP_SECRET replaces that key if you would rather set one'. 2. secret() returns process.env.APP_SECRET and never mixes APP_PASSWORD in — the password is only mixed into the seed-derived key on the other branch. 3. Owner suspects a leak and rotates APP_PASSWORD, which both the README ('changing the password invalidates existing sessions') and auth.ts's own comment ('mixing the password into it keeps the property that changing the password ends every existing session') promise ends every session. 4. It does not: the signing key is unchanged, so every outstanding token still verifies for the remainder of its 30 days. 5. Combined with L2-4 (sign-out revokes nothing) there is then no working way to revoke the stolen cookie at all, and nothing tells the operator that changing APP_SECRET is the lever they actually need.

**Why it matters.** The app's only documented session-revocation mechanism silently does nothing in a supported configuration. A stolen 30-day session survives the exact response — rotate the password — that the documentation tells the owner to make, giving continued full read/write access to the collection, the settings (including the outbound webhook URL), the backup download of the whole database and every photo, and the money-spending identify/refresh routes.

**Evidence.**

src/lib/auth.ts:72-79
  async function secret(): Promise<string> {
    if (process.env.APP_SECRET) return process.env.APP_SECRET;      // <- password never mixed in
    const password = process.env.APP_PASSWORD ?? "";
    const seed = sessionSeed();
    return seed ? await hmac(password, seed) : `collectcollect:${password}`;
  }
README.md:25 — 'Failed attempts are rate limited, and changing the password invalidates existing sessions.'
src/lib/auth.ts:23-30 (doc comment) — '...mixing the password into it keeps the property that changing the password ends every existing session.'
tests/auth.test.ts:60-65 — the regression test 'invalidates existing sessions when the password changes' never sets APP_SECRET, so it exercises only the branch that works.

Driving the real createToken/verifyToken from src/lib/auth.ts:

  APP_SECRET unset (what the test covers): token valid before rotation -> true
  APP_SECRET unset (what the test covers): token still valid AFTER rotation -> false
  APP_SECRET set   (documented option)  : token valid before rotation -> true
  APP_SECRET set   (documented option)  : token still valid AFTER rotation -> true

**Fix.** Make the password bind the signing key on both branches: `if (process.env.APP_SECRET) return await hmac(password, process.env.APP_SECRET);` — the same HMAC-over-the-password construction already used for the seed branch at line 78, so the property holds however the key is supplied. Extend tests/auth.test.ts's 'invalidates existing sessions when the password changes' case to run twice, once with APP_SECRET set, and revert the fix to confirm the new case fails.


### L1-5 · low — Upload MIME allowlist is prototype-reachable, so `Content-Type: constructor` hands SVG/GIF/TIFF bytes to libvips loaders the app does not intend to use

`src/lib/images.ts`:67 · CWE-1321 · reproduced

**Who.** Anyone who can POST to /api/uploads — in the default configuration, anyone who can reach the port. The multipart part's Content-Type is entirely client-chosen.

**How.** 1. POST /api/uploads with a part whose Content-Type header is the literal string `constructor` (or `__proto__`) and whose body is an SVG, GIF or TIFF. 2. `ALLOWED_IMAGE_TYPES[file.type]` is a bare index into a plain object literal, so `ALLOWED_IMAGE_TYPES["constructor"]` returns the Object constructor — truthy — and the check that REVIEW.md's MISS-4 added to make the allowlist authoritative is bypassed. 3. The bytes are handed to `sharp(input, DECODE).metadata()`, which selects a loader from the content: an SVG goes to librsvg, a GIF/TIFF to their own decoders. Only after that does `ALLOWED_FORMATS.has(format)` reject it.

**Why it matters.** Contained, which is why this is low: the decoded-format check at images.ts:79 is a `Set.has` (own-membership only) and does reject the file, and `limitInputPixels: 50_000_000` is now set. What is lost is the first gate — arbitrary bytes reach parsers outside the JPEG/PNG/WebP/HEIC set the app believes it accepts, which is exactly the surface MISS-4 was closed to remove, and it is reached on an unauthenticated route. Any future memory-safety or resource bug in librsvg/libtiff/giflib becomes reachable again.

**Evidence.**

src/lib/images.ts:63-69
  // The allowlist decides, rather than merely being consulted: any `image/*`
  // the client cares to declare would otherwise pass, and image/svg+xml is a
  // vector document handed to a different parser than the raster formats this
  // app believes it accepts.
  if (!ALLOWED_IMAGE_TYPES[file.type]) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }
src/lib/images.ts:7-13 — ALLOWED_IMAGE_TYPES is a plain `Record<string, string>` object literal, so it inherits constructor/__proto__/valueOf/hasOwnProperty.

The two error messages distinguish which gate rejected the file, which is the proof the first one was skipped:
  type="image/svg+xml" status=400 -> {"error":"Unsupported file type: image/svg+xml"}      <- gate 1
  type="constructor"   status=400 -> {"error":"That file is not a JPEG, PNG, WebP or HEIC image"}  <- gate 1 bypassed, libvips parsed it
  type="__proto__"     status=400 -> {"error":"That file is not a JPEG, PNG, WebP or HEIC image"}
  type="toString"      status=400 -> {"error":"Unsupported file type: tostring"}   (lowercased by the runtime, so it misses)
  type="image/gif"     status=400 -> {"error":"Unsupported file type: image/gif"}

I also fed a 1.6 KB SVG entity bomb (nine levels, ~1e12 bytes if substituted) and a 200000x200000 SVG through the bypass; librsvg handled both in under 210 ms and the format check refused them, so I could not get past containment.

**Fix.** `if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, file.type))` at src/lib/images.ts:67, or turn ALLOWED_IMAGE_TYPES into `new Map(...)` / build it with `Object.create(null)` and keep a `Set` of the accepted MIME strings. Same fix as L1-1; worth doing in the same pass. Add the `constructor` and `__proto__` Content-Type cases to the existing upload tests so the gate cannot regress again.


### L2-4 · low — Signing out does not revoke the session token: a captured cookie keeps working for the rest of its 30 days (SEC-10's revocation half was never implemented)

`src/app/api/auth/route.ts`:44 · CWE-613 · reproduced

**Who.** Anyone who obtained one session cookie — a shared or borrowed browser, a browser-profile backup, a plaintext hop when COOKIE_SECURE is unset behind a TLS-terminating proxy. The owner then presses 'Sign out' believing it ends the session.

**How.** 1. Attacker copies the value of the cc_session cookie. 2. Owner clicks Sign out; DELETE /api/auth sets the cookie to "" with maxAge 0 — it clears the owner's browser copy and nothing else. 3. Attacker replays the captured value in a Cookie header. verifyToken only checks that the expiry has not passed and that the HMAC over that expiry matches; there is no per-token identifier and no revocation set, so it verifies.

**Why it matters.** Sign-out gives no protection against a leaked cookie; the session stays live for up to 30 days. Full read/write access to the collection, settings, backup download and the paid identify/refresh routes. REVIEW.md lists SEC-10 as fixed; only its first half (a stored random seed instead of deriving the key from the password) was implemented. Its recommendation's second half — 'include a random per-token identifier in the signed payload so sign-out can record it in a small revocation set' — is absent from the code, and with L2-3 in play there is then no working revocation lever at all.

**Evidence.**

src/app/api/auth/route.ts:43-47
  /** DELETE — sign out. */
  export async function DELETE() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }
src/lib/auth.ts:127-138 — the whole token is `${expires}.${hmac(String(expires), secret)}`; verifyToken checks only expiry and signature. No nonce, no server-side state.
REVIEW.md:256-269 (SEC-10) — 'DELETE /api/auth only clears the client's copy: a captured token stays valid for the rest of its 30 days and cannot be revoked short of changing the password', with the per-token-identifier recommendation. REVIEW.md:15 lists SEC-10 under 'fixed'.

Live run against :3311 (APP_PASSWORD=e2e-secret):
  captured token: 1791723746482.ade48f90fd...
  -- sign out (DELETE /api/auth) --
  200
  -- replay the captured cookie afterwards --
  200
  {"settings":{"gradeMultipliers":{"PSA 10":3,"PSA 9":1.4,...

**Fix.** Put a random identifier in the signed payload — `${expires}.${jti}.${hmac(`${expires}.${jti}`, secret)}` — and have DELETE /api/auth append that jti to a small revoked-token file in DATA_DIR (entries pruned once past their expiry, so it never exceeds one entry per sign-out in a 30-day window). verifyToken rejects a token whose jti is listed. Since both the proxy bundle and the route bundle already read DATA_DIR through src/lib/auth.ts's seedFile() pattern, this needs no new plumbing. Add a test that signs in, signs out, and asserts the captured token no longer verifies.


### L2-5 · low — The auth/CSRF proxy silently truncates every request body at 10 MB, so backup restore — the documented recovery path — fails for any real backup with a misleading error

`next.config.ts`:30 · CWE-754 · reproduced

**Who.** No attacker: this is a silent failure introduced by the security control itself. It matters because restore-from-backup is the app's only recovery path after data loss — including after the hostile-restore scenario REVIEW.md's SEC-1 describes — and it does not work.

**How.** 1. src/proxy.ts exists, so Next clones and buffers every request body to allow the proxy and the route handler each to read it. 2. `experimental.proxyClientMaxBodySize` defaults to 10485760 (node_modules/next/dist/server/config-shared.js:279) and, per Next's own docs, 'the body will only be buffered up to the limit ... The request will not fail or return an error to the client'. next.config.ts does not set it. 3. The owner downloads a backup — 21.4 MB for a collection with a single large photo, and any real collection of photographed cards exceeds 10 MB quickly. 4. They upload it to POST /api/backup/restore, whose own ceiling is 512 MB. The route receives a truncated multipart body, request.formData() throws, and the app answers 400 'Expected multipart/form-data with an archive' — blaming the file, not the limit. 5. The same truncation makes POST /api/uploads's documented 25 MB-per-file / 20-file ceiling unreachable: a 22.4 MB phone photo is rejected as malformed multipart.

**Why it matters.** Backup restore is inoperable for any collection above ~10 MB, and photo upload for any single photo above ~10 MB, with an error message that misattributes the cause — so an owner trying to recover a collection concludes their archive is corrupt. Security-wise the effective ceiling is tighter, not looser, than the app's own (nothing becomes more permissive), so the impact is availability of the recovery path rather than exposure. Worth recording because it is invisible from the code alone — both routes' limits read as enforced — and the e2e backup spec only ever round-trips a tiny collection.

**Evidence.**

node_modules/next/dist/server/config-shared.js:279 — `proxyClientMaxBodySize: 10485760,`
node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md — 'When proxy is used, Next.js automatically clones the request body and buffers it in memory ... By default, the maximum body size is 10MB ... the body will only be buffered up to the limit, and a warning will be logged ... The request will not fail or return an error to the client.'
next.config.ts:30-54 — no `experimental` block; the default stands.
src/app/api/backup/restore/route.ts:5,15,18,24 — TOO_BIG is phrased around RESTORE_MAX_BYTES = 512 MB; the formData() parse at line 18 is what actually fails.
src/app/api/uploads/route.ts:6,22-23 — MAX_BYTES = 25 MB per file.

Live run against :3313, signed in, with the app's own backup:
  backup: 200 22475494
  -rw-r--r-- 1 root root 22475494 big-backup.zip
  restoring a 21.4 MB backup the app itself just produced (route ceiling: 512 MB):
  {"error":"Expected multipart/form-data with an archive"}
  HTTP 400
  # server log:
  Request body exceeded 10MB for /api/backup/restore. Only the first 10MB will be available unless configured.

And for uploads, against :3311 with a 22.4 MB JPEG (route limit 25 MB):
  {"error":"Expected multipart/form-data"}
  HTTP 400
  # server log:
  Request body exceeded 10MB for /api/uploads. Only the first 10MB will be available unless configured.

A small backup (71 KB) round-trips fine, which is why the e2e suite does not see this:
  {"result":{"photos":1,"cards":0,"movedAsideTo":".../replaced-2026-09-11T13-10-53-283Z"}}  HTTP 200

**Fix.** Set `experimental: { proxyClientMaxBodySize: RESTORE_MAX_BYTES }` (or a value at least as large as the largest ceiling any route enforces) in next.config.ts, keeping it in one place with the route constants so the two cannot drift. Better still, since a proxy that never reads the body does not need the clone, also keep the existing declaredTooLarge() pre-check as the real gate. Add an e2e case that round-trips a backup containing a photo larger than 10 MB, so the limit cannot regress silently again.


### L3-1 · low — Next's proxy body clone silently truncates every request body at 10 MB, so the app cannot restore its own backup and its 512 MB / 25 MB ceilings are dead code

`next.config.ts`:29 · CWE-754 · reproduced

**Who.** No attacker is needed to trigger the break - it fires on the owner's own backup. The security consequence is for the attacker the repo already assumes: anyone who can reach the port in the documented default configuration (no APP_PASSWORD, compose publishing 3000 on every interface), who can call POST /api/backup/restore and move the live collection aside.

**How.** 1. Own a collection with more than a handful of photos, so that GET /api/backup produces an archive over 10 MB (eight 2200x1700 photos was enough: 16.9 MB). 2. Feed that archive straight back to POST /api/backup/restore, exactly as the Settings screen does. 3. Next's proxy body clone stops copying at its 10 MB default, the multipart body arrives unterminated, request.formData() throws and the route answers 400 'Expected multipart/form-data with an archive'. The app's own RESTORE_MAX_BYTES (512 MB) and its declaredTooLarge 413 guard are never reached. The same ceiling truncates POST /api/uploads, so any single photo over ~10 MB - ordinary for a modern phone - is refused with 'Expected multipart/form-data' rather than the route's 25 MB limit. Security chain: an unauthenticated peer on the LAN posts a tiny valid archive to /api/backup/restore, which moves the live collection into replaced-<stamp>/; the owner's documented recovery path (restore the last backup) then fails for any backup over 10 MB and they are left with the hand-unpack instructions in the error text.

**Why it matters.** The backup/restore round trip - the app's only recovery path, and the thing that makes a hostile or mistaken restore survivable - is unusable for any real collection, and photos over 10 MB cannot be added at all. The README's explicit guarantee ('It holds the archive in memory, so it is capped at 512 MB') is false: the real cap is 10 MB. The failure is reported as a malformed-request error, so it reads as a broken client rather than a platform limit; the only clue is a Next warning on the server's stdout.

**Evidence.**

node_modules/next/dist/server/body-streams.js: `const DEFAULT_BODY_CLONE_SIZE_LIMIT = 10 * 1024 * 1024` and, in cloneBodyStream, `if (bytesRead > bodySizeLimit) { limitExceeded = true; console.warn(...); p1.push(null); p2.push(null); return; }` - p2 replaces the request body handed to the route handler, so the handler sees the first 10 MB and an end-of-stream. node_modules/next/dist/server/lib/router-utils/resolve-routes.js:124 attaches that clone to every non-upgrade request, and node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md says 'the request will not fail or return an error to the client'. next.config.ts declares no `experimental.proxyClientMaxBodySize`. Measured against a production build (npx next start, DATA_DIR=throwaway):
  8,259,178-byte JPEG  -> HTTP 200 {"uploads":[{"name":"d994b69c-....jpg","bytes":1902935,...}]}
  11,606,861-byte JPEG -> HTTP 400 {"error":"Expected multipart/form-data"}
  16,817,671-byte JPEG -> HTTP 400 {"error":"Expected multipart/form-data"}
  GET /api/backup      -> HTTP 200, 16,926,653 bytes
  POST that same file to /api/backup/restore -> HTTP 400 {"error":"Expected multipart/form-data with an archive"}
  server stdout: 'Request body exceeded 10MB for /api/backup/restore. Only the first 10MB will be available unless configured.'
The unreachable limits: src/lib/backup.ts:147 `export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;`, src/app/api/uploads/route.ts:6 `const MAX_BYTES = 25 * 1024 * 1024;`, and README.md:83 'so it is capped at 512 MB'.

**Fix.** Set `experimental: { proxyClientMaxBodySize: '...' }` in next.config.ts to a value at or above the largest body the app means to accept, and make the app's own ceilings match it rather than exceed it. Concretely: pick one number (say 64 MB), use it for proxyClientMaxBodySize, lower RESTORE_MAX_BYTES (src/lib/backup.ts:147) and MAX_TOTAL_BYTES (src/app/api/uploads/route.ts:8) to it, and keep declaredTooLarge as the 413 - it then fires before truncation can happen for any request that declares a Content-Length. For a chunked request, which declares none, truncation is still silent, so add a post-parse sanity check that turns 'formData() threw' into an explicit 'that upload was larger than N MB' 413 rather than 'Expected multipart/form-data'. Extend e2e/access.spec.ts with a round trip that uploads enough photos to push the backup past the configured limit and asserts the restore succeeds - the current suite only ever moves a two-byte archive and a single small photo, which is why this was invisible.


### L3-2 · low — A 510 KB archive makes the restore route allocate ~650 MB and burn 4 s of CPU before any structural check (1300:1 amplification, no rate limit)

`src/lib/backup.ts`:148 · CWE-409 · reproduced

**Who.** Anyone who can reach port 3000. In the configuration the README documents as normal ('Leave it unset and there is no login at all, which is fine on a machine only you can reach') and that compose publishes on every interface, that is any peer on the LAN with no credentials. With APP_PASSWORD set it needs a session, and the proxy's cross-site guard keeps a hostile web page out.

**How.** 1. Build a zip whose central directory declares just under RESTORE_MAX_BYTES of uncompressed data - five deflated entries of 100 MB of zeros compress to 510 KB total. 2. POST it to /api/backup/restore as multipart 'archive'. declaredTooLarge passes (510 KB), file.size passes, and readZip then budgets against the *declared* uncompressed sizes with limits.maxTotalBytes = 512 MB, inflating every entry into the `entries` array and CRC-32ing each one in JavaScript before restoreBackup ever looks at a name. 3. The request is finally rejected with 'That archive has no collectcollect.db', after the memory and CPU have been spent. 4. Repeat, or send several at once: there is no rate limiter on this route and no in-flight cap, so N concurrent requests cost N x ~650 MB. compose.yaml sets no mem_limit and `restart: unless-stopped`, so an OOM kill becomes a restart loop.

**Why it matters.** Remote memory and CPU exhaustion of the whole app at ~1300:1 amplification from a request small enough to send from a phone - the collection is unavailable while it lasts. It is the residue of REVIEW.md SEC-4, whose fix landed only as the Content-Length precheck (`declaredTooLarge`); the reviewer's own higher-value recommendation ('lower RESTORE_MAX_BYTES to something a 1-2 GB container can actually hold (64-128 MB) and write each entry to the staging directory as it is read in readZip instead of accumulating a photos array') was not done, and after L3-1 the raw body is capped at 10 MB by the platform anyway, which leaves this decompression budget as the only exposure that still matters. Rated low, not higher, because in the default configuration the same attacker can already read and delete the collection outright, so the marginal gain is denial of service only.

**Evidence.**

src/lib/backup.ts:147-148 `export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;` / `const RESTORE_LIMITS = { maxTotalBytes: RESTORE_MAX_BYTES, maxEntries: 100_000 };`. src/lib/zip.ts:186-216 budgets against the declared size and keeps every inflated entry: `total += uncompressedSize; if (total > limits.maxTotalBytes) throw ...` then `inflateRaw(raw, { maxOutputLength: Math.min(remaining, uncompressedSize) + 1 }, ...)` and `entries.push({ name, data })`. src/lib/backup.ts:166-181 only rejects unexpected entry names *after* readZip has returned everything. src/app/api/backup/restore/route.ts has no rateLimit() call, unlike /api/identify, /api/prices/refresh, /api/cards/[id]/price and /api/sets/refresh.
Measured against a production build, watching VmRSS of the next-server process:
  archive on disk: 510,497 bytes (declared 500 MB uncompressed)
  RSS before: 327 MB -> peak during the single request: 1000 MB (+673 MB)
  response: HTTP 400 {"error":"That archive has no collectcollect.db, so it is not a CollectCollect backup"}
  wall clock for one request: 4.15 s

**Fix.** Three changes, any one of which blunts it, all three together close it: (1) lower RESTORE_MAX_BYTES / RESTORE_LIMITS.maxTotalBytes to something a small container can hold (64 MB is far more than the largest archive the 10 MB body clone can deliver anyway); (2) make readZip stream each entry to the staging directory instead of returning a ReadEntry[] of Uint8Arrays, and move the entry-name validation in restoreBackup (src/lib/backup.ts:170-181) into that loop so an archive that contains something this app did not write is rejected before its data is inflated at all; (3) put the same rateLimit() the other expensive routes use on POST /api/backup/restore (a restore is a once-in-a-while action - a handful per hour is generous) and refuse a second restore while one is in flight, which lockDatabase already knows how to express. Add a test with a declared-500 MB / 510 KB archive asserting it is refused without inflating - it is a natural companion to the existing oversized-expansion case in tests/zip.test.ts.


## Checked and sound

What the reviewers tried and could not break. Recorded so it is not re-raised, and so a future change that undoes one of these is recognisable as a regression.

- src/lib/zip.ts readZip — fed it a 100 MB-of-zeros deflate bomb (accepted within budget, correctly), an entry declaring uncompressedSize=10 while inflating to 100 MB (rejected: 'could not be decompressed within its declared size', 2 ms), 120 x 6 MB entries against a 512 MB budget (rejected at the ceiling), and 64 MB of non-zip junk (rejected in 283 ms — the EOCD scan is bounded to 64 KB + 22). Budgeting on the declared size before inflating, capping maxOutputLength, then re-checking data.length and the CRC is correct and I could not get past it.
- src/lib/zip.ts isSafeEntryName — '../../etc/passwd', '/etc/passwd', 'uploads/../../x.jpg', 'C:\\x', 'a\0b' and '....//x' are all rejected. Reading the central directory rather than scanning for local headers, and refusing a local header whose name disagrees with the directory, closes the classic doctored-archive tricks.
- Photo extraction on restore — isValidUploadName (/^[a-f0-9-]{36}\.(jpg|png|webp)$/) is applied to every uploads/ entry before writing, and uploadPath() throws rather than joining an unvalidated name, so a crafted archive cannot write outside the uploads directory. GET /api/uploads/[name] re-validates and serves a fixed image/jpeg with nosniff (confirmed on the wire), so a restored non-image file cannot be served as HTML.
- SQL — every query in cards.ts, sales.ts, submissions.ts, alerts.ts, settings.ts and sets/index.ts uses better-sqlite3 bound parameters. listCards is the only place that assembles SQL, and it concatenates only fixed clause strings while the values go through named params; I could not find a path where an outside string reaches the statement text. The LIKE wildcard issue REVIEW.md notes is a search-quality bug, not injection.
- No dangerouslySetInnerHTML, innerHTML, eval, new Function, dynamic import() of a computed path, child_process or shell anywhere in src/ (grepped). Every outside string reaches the DOM as a JSX text child or an escaped attribute.
- URL rendering — httpUrl() really is applied at every site that takes an outside URL: PricePanel.tsx:84 (provider quote urls), CardDetail.tsx:191-192 (reference image), sets/[game]/[name]/page.tsx:55-57 (checklist imageUrl), and imageSrc() in format.ts covers CardTile, Portfolio and the report. REVIEW.md's SEC-11 is properly closed. A restored reference_image_url of 'javascript:alert(1)' renders as nothing.
- accentColor — validated to /^#[0-9a-f]{6}$/i on write (cards.ts:100-103) and rendered only as a CSS custom property through React's style object, which escapes; a hostile value from a restored database cannot break out of the style attribute.
- Prototype pollution proper (as opposed to prototype-chain lookups) — I traced every object built from outside keys: settings.ts sanitizeNumbers writes numbers, so `out.__proto__ = n` is the no-op assignment; getSettings and refreshCard use object spread and Object.fromEntries, which define own properties rather than invoking the __proto__ setter; pricing/index.ts summarize guards with `k in graded` before writing. Nothing mutates Object.prototype.
- CSRF / DNS rebinding / headers — verified on the wire that a POST carrying 'Sec-Fetch-Site: cross-site', or 'Origin: https://evil.example', or the opaque 'Origin: null' is refused 403, that 'Host: evil.example.com' is refused 403, and that CSP, nosniff, Referrer-Policy and X-Frame-Options are present on an /api/uploads response. REVIEW.md's SEC-1, SEC-8 and MISS-1 hold.
- Image decode budget — MAX_PIXELS 50 MP and sequentialRead are now passed to every sharp() call (DECODE at images.ts:26), and the decoded-format check is a Set.has, so even with the L1-5 bypass an SVG entity bomb (1e12 declared expansion) and a 200000x200000 SVG both return in ~200 ms and are refused.
- Alert webhook SSRF — outboundRefusal() resolves the host and rejects loopback, RFC1918, link-local/169.254.169.254, CGNAT, IPv4-in-IPv6 and multicast, and deliver() uses redirect:'manual' with a 10 s timeout and never reports the response body back to a caller. I read isPrivateAddress carefully looking for a parsing gap and did not find one.
- Identification blob — REVIEW.md's SEC-12 is closed: normalizeInput runs it through IdentificationSchema.partial() (cards.ts:112-120), so a client cannot persist an arbitrary document there, and alertsForRefresh's optional chaining is now honest. The remaining gap is that individual string fields are length-unbounded, which is bounded in practice by the 10 MB proxy buffer of L1-4.
- CSV parser (src/lib/csv.ts) — single pass, no backtracking, no regex over the input; a quoted field that never closes ends the file rather than looping. The import cost is in intakeCard (L1-3), not the parser.
- Regex — every pattern in the repo (COMPANY_PATTERN, normalizeNumber, match.ts tokenisers, NAME_RE, hexColor) is linear with no nested quantifier; no regex is built from input, so there is no ReDoS.
- Login gate — the limiter no longer trusts X-Forwarded-For unless TRUST_PROXY is set, has a process-wide 50-failures ceiling, a 250 ms per-failure delay and a bounded map; the session key is a random 256-bit seed written with flag 'wx' rather than being derived from the password; comparisons use a length-independent constant-time helper. REVIEW.md's SEC-2, SEC-9 and SEC-10 hold.
- safeNext() in LoginForm resolves ?next= against the current origin and rejects anything that leaves it, including the protocol-relative '/\\' form.
- Proxy bypass by path: drove the running server with /login/../api/cards, /login/%2e%2e/api/cards, /login%2f..%2fapi/cards, /%2e/api/cards, //api/cards, /api/cards/, /API/cards, /api/cards?_rsc=1, /_next/static/../../api/cards, /_next/staticfoo/../api/cards, /favicon.ico/../api/cards, and raw-socket requests with absolute-form request URIs, a missing Host (HTTP/1.0), duplicate Host headers, path parameters (;x=1), backslashes, %2F, %00 and Unicode one-dot-leaders. Every one either 401s, 307s to /login or 403s — the matcher is evaluated against the already-normalised pathname, so nothing resolves to a route after escaping the negative lookahead.
- The CVE-2025-29927-style header bypass: x-middleware-subrequest in four spellings, x-nextjs-data and x-invoke-path all still get 401 on Next 16.3.4.
- /_next/image is excluded from the proxy matcher, but it is not a way around the gate. localPatterns lets it fetch a local path, and it does fetch /api/uploads/<name> internally — but that subrequest goes through the proxy and comes back 401, so the optimizer answers 400 'The requested resource isn't a valid image' both with and without a session cookie. remotePatterns is empty, so no external URL is fetchable. The app does not use next/image anywhere, so nothing is cached there either.
- There are no Server Functions ('use server' appears nowhere in src/), which is the documented way a route can be POSTed to outside a proxy matcher, and no public/ directory whose files would be served by the filesystem route.
- The four spend limiters (identify, prices-refresh, card-price, sets-refresh) pass fixed literal bucket names to rateLimit(), not clientKey, so the X-Forwarded-For problem in L2-1 does not reach them. They are process-wide by design, and they sit behind the password gate when one is set.
- recordLoginFailure's map cannot be grown without bound by key rotation: entries are only added when loginBlocked is false, and the process-wide ceiling caps that at 50 per 15-minute window, while the size>1000 sweep drops expired records.
- Token forgery: verifyToken parses the expiry with Number() and re-signs String(expires), so a re-spelled prefix (' 1791…', '0x…') can only match the signature if it round-trips to the identical decimal string — the expiry cannot be extended without the key. A forged expiry with a genuine signature, an expired-but-genuine token, and a token from an instance with a different DATA_DIR all fail.
- Key derivation with APP_SECRET unset: the signing key is HMAC-SHA256(key = a 256-bit random seed from crypto.getRandomValues, message = the password), written to DATA_DIR/session-secret with flag 'wx' and mode 0600. A captured cookie is therefore not an offline password oracle, which is what SEC-10 was about. The seed is not included in the backup archive (buildBackup takes only collectcollect.db and uploads/<valid name>), and restoreBackup moves aside only the database and the uploads directory, so it cannot be displaced by a hostile archive.
- timingSafeEqual is correct: it XORs the lengths into the accumulator so a length difference can never produce 0, and maps out-of-range charCodeAt (NaN) and U+0000 to the same 0 on both sides. passwordMatches HMACs both sides with a fresh crypto.randomUUID nonce first, so the comparison always runs over equal-length digests.
- Host allowlist: a trailing dot is stripped on both sides, a bracketed IPv6 authority is unwrapped, a port is removed before comparison, an empty Host is refused, and ALLOWED_HOSTS entries are compared as exact port-stripped names. `Host:  attacker.example ` (padded) is still refused. The default accepts only addresses, single-label names and the undelegated private-use suffixes, none of which a public DNS record can impersonate.
- Cross-site write guard: reproduced refusal for sec-fetch-site cross-site/same-site, Origin mismatches including the opaque 'null' origin and a different port on the same host, across POST/DELETE and on page routes as well as /api — while header-free clients (curl) and the app's own same-origin requests pass.
- Pre-auth memory amplification through the proxy's body clone: 30 concurrent 10 MB POSTs to a gated route with no session moved the server's RSS by under 10 MB in total and all 30 were answered 401, so Next is not holding a 10 MB buffer per rejected request.
- Secrets: no APP_PASSWORD, APP_SECRET, ANTHROPIC_API_KEY, PRICECHARTING_TOKEN or session-secret value appears in .next/static (the only matches are the literal string 'ANTHROPIC_API_KEY' inside the Settings page's help text). providerStatuses() returns booleans and labels only. Provider errors are phrased as 'X returned HTTP nnn' and never interpolate the token-bearing URL. git history contains no committed .env, database or secret file, and .gitignore/.dockerignore exclude /data and .env*.
- The root layout independently re-verifies the session cookie before rendering the nav or touching the database (src/app/layout.tsx:28), so the gate does not rest on the proxy alone for page rendering.
- Session cookie flags: HttpOnly, SameSite=Lax, Path=/, host-only (no Domain), 30-day maxAge, with Secure settled by COOKIE_SECURE, then X-Forwarded-Proto only under TRUST_PROXY, then the request scheme — the SEC-9 fix behaves as its tests claim.
- The ?next= open redirect is closed: safeNext resolves against window.location.origin and returns '/' for //evil, /\evil, absolute and javascript: forms; the proxy builds the parameter with encodeURIComponent.
- The app-wide header set really does reach every response I could produce from a production build: the root page, a 404 page, /api/cards JSON, a 404 and a 200 from /api/uploads/[name], a 405 on a wrong method, a 204 OPTIONS, a real /_next/static/chunks/*.js asset (alongside its public immutable Cache-Control), the /favicon.ico 404, and both of the proxy's own 403 refusals (bad Host and cross-site write). The one exception is Next's pre-routing 308 normalisation redirect (trailing slash, repeated slashes), which carries no headers and no body beyond the normalised path - it is emitted before the proxy runs, so it also skips the Host check, but it discloses nothing.
- The webhook address guard was driven with 30 URLs through the real outboundRefusal(): decimal (2130706433), octal (0177.0.0.1), hex (0x7f.1) and short-form (127.1) IPv4, ::1 in long form, ::ffff:127.0.0.1 and ::ffff:7f00:1, fd00::/fe80::, 0.0.0.0, ::, 169.254.169.254, all three RFC1918 ranges, localhost / LOCALHOST / sub.localhost / localhost. , credentials-in-URL, file: and gopher: - all refused. DNS names were the point of the exercise and they hold: localtest.me, localtest.me. and 127.0.0.1.nip.io are each refused on the resolved address ('resolves to 127.0.0.1, which is on a private network'), which is the right design - the name-level checks are only a shortcut. Gaps found and judged not worth reporting: the NAT64 prefix 64:ff9b::7f00:1 and 6to4-style 2002:: embeddings are not decoded to their IPv4 payload, and the check-then-fetch window (two independent resolutions) leaves classic DNS rebinding open - the code comment already states that residual, deliver() sends a fixed envelope, uses redirect:'manual', and reports nothing back to any caller.
- The proxy's auth gate cannot be walked around with path tricks. Against a password-protected instance, /api/cards, /./api/cards, /api/../api/cards, /_next/static/../../api/cards, /_next/image/../../api/cards, /favicon.ico/../api/cards and /api/cards%2f all returned 401; //api/cards, /api//cards and /api/cards/ returned 308 to the canonical path; /%61pi/cards, /API/cards, /%2fapi/cards and /..%2fapi%2fcards returned the 307 to /login. Nothing reached a handler.
- /_next/image is excluded from the proxy matcher, but it is not a way past the gate: its internal fetch goes back through the server, so on a password-protected instance /_next/image?url=%2Fapi%2Fuploads%2F<a real upload name> answers 400 'The requested resource isn't a valid image' (the inner request got the 401), while the identical URL on an open instance returns the JPEG. An external url is refused outright ('"url" parameter is not allowed') because no images.remotePatterns are configured, so it is not an SSRF or an image proxy either.
- The Host allowlist behaves as documented under fourteen Host values: evil.example, evil.example., EVIL.EXAMPLE, evil.example:3400, 127.0.0.1.evil.example, '127.0.0.1 evil.example' and an empty Host are all 403; 127.0.0.1:3400, [::1]:3400, localhost, a single-label name, .local, .internal and .home.arpa pass by design. Duplicate Host headers and X-Forwarded-Host: evil.example do not move it (the raw Host header is what is read), and a request with no Host at all is rejected by Node before Next sees it. The single-label and private-suffix allowances cost nothing an attacker can use: none is resolvable by a public DNS record, and an on-LAN attacker who could spoof mDNS/LLMNR for one would land on an origin that carries none of the owner's session cookie.
- Upload serving has no traversal: /api/uploads/..%2F..%2Fsession-secret and /api/uploads/%2e%2e%2fcollectcollect.db both 404 before any filesystem call, because isValidUploadName runs first and uploadPath() throws rather than joining. The stored bytes are always a re-encoded JPEG under a fresh UUID, served as image/jpeg with nosniff from the app-wide config, so a restored archive smuggling HTML in as <uuid>.png cannot be rendered as a document.
- The image decode bomb that SEC-6 was about is genuinely contained: a 153 KB PNG that declares 49 megapixels (just under the 50 MP limitInputPixels budget), posted four times concurrently to /api/uploads, moved the server's RSS by 49 MB in total (226 -> 275 MB) and all four returned 200. sequentialRead keeps libvips from materialising the full raster, so I could not turn image decoding into memory exhaustion.
- Nothing sensitive ships to the browser: zero .map files under .next/static, and the only ANTHROPIC_API_KEY matches in the client chunks are the two UI banners that name the variable. No secret, no process.env read and no database content reaches a client component.
- Reverse-proxy header trust is mostly as the code claims, with one drift worth recording. X-Forwarded-For is consulted only under TRUST_PROXY (rate-limit.ts clientKey), and X-Forwarded-Host is never consulted. X-Forwarded-Proto is not what auth.ts thinks, though: Next itself derives request.url's scheme from that header (resolve-routes.js builds initURL with `req.headers['x-forwarded-proto']?.includes('https') ? 'https' : 'http'`), so with TRUST_PROXY unset a client that sends X-Forwarded-Proto: https gets a Secure session cookie from a plain-HTTP instance - I reproduced both Set-Cookie variants. Not reported as a finding: the header is not CORS-safelisted so no web page can set it on a victim's request, the proxy refuses the cross-site POST anyway, and the drift is in the fail-safe direction (more Secure, never less). The comment at src/lib/auth.ts:82-88 is nonetheless inaccurate.
- An absolute-form request line (GET http://evil.example/api/cards HTTP/1.1 with Host: 127.0.0.1) makes Next answer 308 with Location: http://evil.example/api/cards, before the proxy and without the header set - a platform open redirect. Left unreported because no browser emits a proxy-style request target to an origin server, the protocol-relative form a browser can emit (//evil.example/x) is normalised to /evil.example/x, and the response carries no application data.
- Temporary files are handled properly: buildBackup and restoreBackup both use fsp.mkdtemp (0700) under os.tmpdir(), and the backup's directory is removed when the stream closes, errors or is cancelled. Ten concurrent rate-limited downloads created exactly ten staging directories, each holding one SQLite copy, and all ten were gone once the clients disconnected. The session key file is written with mode 0600 and flag 'wx'.
- Browser-side platform surface is empty by construction: no service worker, no postMessage, no iframe, no localStorage/sessionStorage, no innerHTML or dangerouslySetInnerHTML, no next/image, no server actions, and the built HTML references no external origin at all (next/font self-hosts Barlow Condensed under /_next/static), so the CSP - default-src 'self', object-src 'none', base-uri 'none', form-action 'self', frame-ancestors 'none', connect-src 'self' - matches what the app actually loads. script-src keeps 'unsafe-inline' for Next's bootstrap, but with nosniff on every response no same-origin route (JSON, CSV, image/jpeg) can be loaded as a script, so there is no injection sink behind it.
- No route is prerendered: .next/prerender-manifest.json lists only /_not-found and /_global-error, so no handler serves build-time collection data and every request passes through the proxy.
- git history and the working tree carry no .env, no database, no session-secret and no photos; .gitignore covers /data and .env*, and .dockerignore keeps data, .git and .env out of the image while letting .env.example through.

