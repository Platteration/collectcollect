# CollectCollect — security & upgrade review (2026-09-09)

Two independent reviewers read every first-party file in this repository; a third then re-read each security or bug claim against the code and tried to refute it. Only claims that survived that check are listed as findings; the ones that did not are recorded at the end so they are not re-raised.

## Status — what has been fixed

All of the following are fixed on `claude/repo-review-security-baiyud`, each with a regression test that was checked by reverting the fix.

**First pass** — every critical and high finding, plus the medium ones that were quick:

`SEC-1`, `SEC-2`, `SEC-5`, `MISS-1`

**Second pass** — the remaining medium findings and the low-severity ones that were trivial or small:

`BUG-1`, `SEC-3`, `SEC-4`, `SEC-8`, `SEC-10`, `SEC-11`, `BUG-3`, `BUG-4`, `MISS-3`, `MISS-4`, `SEC-6`, `SEC-7`, `SEC-9`, `SEC-12`

Deliberately not done: `SUP-1`. Each was either already covered by an earlier pass, or judged churn or too risky to make without a device or a measurement. The reasoning is in the commit that touched it.

**Third pass** — a security audit of this branch, which found both things the earlier passes left and one the earlier passes caused:

- Every enum whitelist was an `in` test or a bare index, so `__proto__` passed as a game and one unauthenticated POST left every page answering 500 for good. All of them are own-property lookups now (`has` in `src/lib/types.ts`), and the render sinks fall back to the raw string (`label`) so a row that predates the check still draws.
- A restore validated the archive's entry names but never a single row of the database it installed, and the price-snapshot and checklist columns were parsed without a guard — so a 16 KB archive bricked the app with no way back through it. The staged rows now go through the write path's own rules before anything live is moved aside.
- `MISS-2` is now done: a stored `name_key` with an index (5,000 duplicate lookups over 5,000 cards: 9.5 s before, 38 ms after), one transaction around the whole file, and a cap on the rows one import may carry.
- Adding `src/proxy.ts` in the first pass made Next buffer a copy of every request body and truncate it past 10 MB *without failing the request*, which silently broke restore-from-backup — the app's only recovery path — for any collection over that. One number now governs: `MAX_REQUEST_BYTES` in `src/lib/limits.ts`, which sets `experimental.proxyClientMaxBodySize` and `RESTORE_MAX_BYTES` together. Lowering the restore ceiling from 512 MB to 64 MB is also the rest of `SEC-4`.
- The login limiter read `X-Forwarded-For` from the left, which the client writes, and shared one bucket when no proxy was declared — so the lockout could be evaded, aimed at the owner, or filled by any stranger. It now counts hops from the right, validates the entry is an address, and gives an unidentifiable caller no key at all; the password is compared before any counter, so no counter can refuse the right one.
- `SEC-10`'s second half is now done: tokens carry a random identifier and signing out records it, so a captured cookie stops working. `APP_SECRET` now has the password mixed into it, so rotating the password ends every session on that branch too, as the README always said it did.

An independent reviewer then read each commit and tried to find what was wrong with it, and a second reviewer tried to refute every objection raised. What survived that was fixed in a follow-up commit.

Repository hardening applied here as well: every GitHub Action is pinned to a commit rather than a floating tag, each workflow declares a least-privilege `permissions` block, and a Dependabot config, a licence and a security policy are in place.

The rest of this document is the review as written. Fixed items are left in place so the reasoning behind each change stays with it.

## Summary

CollectCollect is a single-user, self-hosted Next.js 16 / React 19 app that identifies trading cards from photos with Claude vision, prices them raw and graded from four providers, and presents the collection as a brokerage-style portfolio with a min/max "when to grade" outlook, sales ledger, grading submissions, alerts, CSV import/export, set-completion tracking and a dependency-free zip backup/restore. It is unusually mature for a personal project: 21 focused commits, ~12k lines, 13 vitest suites plus 11 Playwright specs driving a real production build, CI running lint/typecheck/test/build/e2e, zero npm audit findings, and no TODO/FIXME anywhere. The Anthropic integration is already current and correct (claude-opus-5, adaptive thinking, structured outputs via zodOutputFormat, server-side refusal fallbacks, a specific-first error chain) — the gaps there are cost controls, not correctness. The headline problems are elsewhere: the Dockerfile copies a `public/` directory that does not exist so `docker compose up --build` cannot work and CI never builds the image to notice; there is no same-origin/CSRF guard or security headers, which matters because the app runs unauthenticated by default and compose binds 0.0.0.0; and the portfolio page loads and JSON-parses every price snapshot ever taken then recomputes totals over every card per snapshot, so it degrades quadratically as history accumulates. Everything else is tooling hygiene (Node 22 is in maintenance, ESLint 9 is on the maintenance tag, TypeScript is a major version behind, actions unpinned, no Dependabot/LICENSE/SECURITY.md) plus a batch of contained refactors and named missing tests.

## Attack surface

A self-hosted Next.js 16 app (React 19, better-sqlite3, sharp) with 25 API route handlers under src/app/api/, a Docker image that publishes port 3000 on all interfaces, and a /data volume holding the SQLite database plus every uploaded photo. Authentication is entirely optional: src/proxy.ts gates every path only when APP_PASSWORD is set, so in the default configuration all 25 routes -- including DELETE /api/cards/[id], POST /api/backup/restore (replaces the whole collection from an uploaded zip), GET /api/backup (streams the database and all photos), PUT /api/settings and the money-spending POST /api/identify -- are reachable by anyone who can open the port, and by any website the owner visits that issues a CORS-simple cross-origin POST. Untrusted input arrives as: uploaded images decoded by sharp, an uploaded zip archive parsed by a hand-written reader in src/lib/zip.ts and unpacked over the live database, CSV text parsed by src/lib/csv.ts, JSON bodies on every route, and JSON responses from four third-party price/checklist APIs whose urls and image urls are rendered as links. Card photographs are sent to Claude (claude-opus-5) and the structured result is written back into the collection, so photo content is an indirect prompt-injection channel. Outbound requests the server makes on its own: four fixed price/checklist hosts and one owner-configured alert webhook URL, which is the only fetch target an HTTP client can choose. Secrets (ANTHROPIC_API_KEY, PRICECHARTING_TOKEN, POKEMONTCG_API_KEY, APP_PASSWORD) live only in server-side process.env and are never returned to the browser.

## Already done well

- LLM output is never trusted as code, a path or a URL: the identification is constrained by a zod schema (src/lib/identify/schema.ts) and every field it produces is either rendered as React text or passed through encodeURIComponent into a fixed provider host (src/lib/pricing/providers/*.ts). Image filenames come only from crypto.randomUUID() in saveUpload, never from the model.
- The Anthropic integration is current and correct: claude-opus-5, thinking {type:'adaptive'}, output_config with zodOutputFormat, and the server-side-fallback-2026-07-01 beta with fallbacks:'default'; stop_reason 'refusal' and 'max_tokens' are both handled and stop_details is guarded before use (src/lib/identify/claude.ts:44-127).
- Upload names are validated against a strict UUID+extension regex before any filesystem access, and uploadPath() throws rather than joining an unvalidated name, so /api/uploads/[name] has no traversal (src/lib/images.ts:15-19,65-68).
- The zip reader is genuinely defensive: it reads through the central directory, cross-checks the local header's name, budgets uncompressed bytes before inflating and passes maxOutputLength to inflateRaw, verifies CRC-32, and isSafeEntryName rejects absolute paths, '..', backslashes and NUL (src/lib/zip.ts:156-241). restoreBackup then only accepts three exact entry shapes and opens the staged database before touching anything live (src/lib/backup.ts:136-167).
- All SQL goes through better-sqlite3 prepared statements with bound parameters; the one dynamically built query (listCards) concatenates only fixed clause strings and binds all values (src/lib/cards.ts:303-322).
- CSV export neutralises spreadsheet formula injection by prefixing cells starting with = + - @ tab or CR (src/app/api/export/route.ts:11-17).
- The login redirect is closed against open redirect by resolving ?next= against the origin, with tests covering //evil, /\evil, absolute and javascript: forms (src/components/LoginForm.tsx:12-19, tests/auth.test.ts:54-66).
- Session tokens are HMAC-SHA256 signed, expiry-bound, compared with a constant-time helper, and invalidated by a password change; the password comparison hashes both sides with a per-attempt random nonce first (src/lib/auth.ts:31-63).
- Card input is normalised and validated server-side before storage: game/condition/gradingStatus against enums, referenceImageUrl restricted to http(s), accentColor to a #rrggbb literal, imagePath to a valid upload name (src/lib/cards.ts:92-168).
- No innerHTML, dangerouslySetInnerHTML, eval or new Function anywhere in src/, and no secrets or process.env reads in any client component.
- Docker runs as the non-root node user with a standalone build and a separate /data volume (Dockerfile:13-18); CI uses npm ci with a committed lockfile and runs lint, typecheck, unit tests, build and the Playwright suite (.github/workflows/ci.yml).
- Security behaviour is actually tested: the zip suite asserts refusal of doctored entry names, escaping paths, oversized expansion, bad checksums and un-openable databases (tests/zip.test.ts:154-273), and e2e/auth.spec.ts asserts that an API call without a session returns 401.

## Findings (21)

| # | Severity | Category | Title | Where | Effort | Status |
|---|---|---|---|---|---|---|
| SEC-1 | Medium | security | Any website the owner visits can wipe and replace the collection (no CSRF defence when APP_PASSWORD is unset) | `src/app/api/backup/restore/route.ts:10` | small | confirmed |
| SEC-2 | Medium | security | Password brute-force limiter is keyed on the client-controlled X-Forwarded-For header | `src/app/api/auth/route.ts:10` | small | confirmed |
| SEC-5 | Medium | security | No rate limiting or in-flight guard on the routes that spend money and hammer third-party APIs | `src/app/api/identify/route.ts:10` | small | confirmed |
| BUG-1 | Medium | bug | Uploaded photos are never garbage-collected, so the data directory and every backup grow without bound | `src/lib/images.ts:61` | medium | confirmed |
| MISS-1 | Medium | security | No Host-header check, so DNS rebinding turns the unauthenticated default into a full remote read of the collection | `src/proxy.ts:8` | small | found by second reviewer |
| SEC-3 | Low | security | Alert webhook is an unrestricted blind-SSRF sink (loopback, RFC1918 and cloud metadata all allowed) | `src/lib/settings.ts:56` | small | confirmed, severity lowered |
| SEC-4 | Low | security | Request bodies are fully buffered in memory before any size check, on three routes | `src/app/api/backup/restore/route.ts:12` | small | confirmed, severity lowered |
| SEC-6 | Low | security | sharp decodes untrusted images with error checks disabled and no pixel budget | `src/lib/images.ts:56` | trivial | confirmed, severity lowered |
| SEC-7 | Low | security | Docker publishes the unauthenticated app on every interface | `compose.yaml:4` | trivial | confirmed, severity lowered |
| SEC-8 | Low | security | No security headers or CSP on any response | `next.config.ts:3` | small | confirmed |
| SEC-9 | Low | security | Session cookie loses its Secure flag behind a TLS-terminating reverse proxy | `src/app/api/auth/route.ts:42` | trivial | confirmed |
| SEC-10 | Low | security | Session signing key defaults to a constant prefix plus the password, and tokens carry no session identity | `src/lib/auth.ts:20` | small | confirmed |
| SEC-11 | Low | security | URLs from third-party APIs and from restored databases are rendered into href/src without the guard the write path applies | `src/components/PricePanel.tsx:84` | small | confirmed |
| SEC-12 | Low | security | The identification blob is stored from the client without validation | `src/lib/cards.ts:163` | trivial | confirmed |
| SUP-1 | Low | supply-chain | GitHub Actions are referenced by mutable tags and the workflow grants default token permissions | `.github/workflows/ci.yml:13` | trivial | confirmed |
| BUG-2 | Low | reliability | A restore that fails part way leaves the app with no database and no photos | `src/lib/backup.ts:179` | medium | confirmed |
| BUG-3 | Low | bug | The login page renders the whole signed-in nav, including the unread alert count | `src/app/layout.tsx:22` | small | confirmed |
| BUG-4 | Low | bug | Object URLs for scanned photos are never revoked | `src/components/ScanFlow.tsx:204` | small | confirmed |
| MISS-2 | Low | bug | CSV import runs an unindexed full-table scan per row, synchronously, with no cap on rows | `src/lib/import.ts:193` | medium | found by second reviewer |
| MISS-3 | Low | bug | Restore's `replaced-*` folders are never cleaned up or surfaced, so each restore permanently doubles the data directory | `src/lib/backup.ts:172` | small | found by second reviewer |
| MISS-4 | Low | security | The upload type allowlist is inert: any `image/*` the client declares is accepted, including SVG | `src/lib/images.ts:50` | small | found by second reviewer |

### SEC-1 · Any website the owner visits can wipe and replace the collection (no CSRF defence when APP_PASSWORD is unset)

**Severity:** Medium · **Category:** security · **Effort:** small · **Where:** `src/app/api/backup/restore/route.ts:10`

With APP_PASSWORD unset (the documented default) src/proxy.ts returns NextResponse.next() for every request and no route performs any check of its own, and nothing anywhere validates Origin, Sec-Fetch-Site or a CSRF token. POST /api/backup/restore accepts multipart/form-data, which is a CORS-safelisted content type, so a page on any origin can run fetch('http://localhost:3000/api/backup/restore', {method:'POST', mode:'no-cors', body: formDataWithCraftedZip}) while the owner browses it; the request succeeds, the whole database and every photo are moved aside and replaced with the attacker's archive, and the opaque response tells the attacker nothing but the damage is done. POST /api/prices/refresh needs no body at all, so a plain auto-submitting HTML form drains the Anthropic/PriceCharting budget; POST /api/identify, /api/import, /api/sets/refresh and /api/cards/intake are reachable the same way because Request.json() parses the body regardless of Content-Type, so an enctype=text/plain form can deliver valid JSON. This works even on a machine that only the owner can reach, which is exactly the deployment the README recommends, so the 'private network' caveat does not cover it. Confidentiality is protected (cross-origin reads are blocked by the same-origin policy), integrity and cost are not.

Evidence:

```
src/proxy.ts:8 `if (!authEnabled()) return NextResponse.next();`
src/app/api/backup/restore/route.ts:11-18 `form = await request.formData(); ... const file = form.get("archive");`
src/app/api/prices/refresh/route.ts:5-9 `export async function POST(request: Request) { const stale = ... const result = await refreshAll({ staleHours });`
```

**Recommendation.** Same place, but do not require Sec-Fetch-Site to be present: a plain `curl -X POST` (a reasonable thing for the owner to do against their own box) sends neither Sec-Fetch-Site nor Origin, and the proposed rule would 403 it. Use the standard browser-only rule in src/proxy.ts, above the `if (!authEnabled())` early return: for methods other than GET/HEAD/OPTIONS, reject when `sec-fetch-site` is present and is not `same-origin`, and reject when `origin` is present and does not equal `request.nextUrl.origin`; allow when both headers are absent. That blocks every browser-driven cross-site request (browsers always send Sec-Fetch-Site) while leaving scripts and the app itself working.

### SEC-2 · Password brute-force limiter is keyed on the client-controlled X-Forwarded-For header

**Severity:** Medium · **Category:** security · **Effort:** small · **Where:** `src/app/api/auth/route.ts:10`

clientKey() takes the first entry of the X-Forwarded-For request header, which the client sets, and falls back to the constant 'local' only when it is absent. An attacker guessing the password sends a different X-Forwarded-For on each attempt and never reaches MAX_ATTEMPTS, so the 8-attempts-per-minute lockout is decoration; conversely, an attacker can pin someone else's address into lockout. There is no proxy configuration or trusted-hop count anywhere in the app, so the header is not trustworthy in any deployment. Since APP_PASSWORD is a single shared secret with no complexity requirement and /api/auth is in the proxy's PUBLIC list, this is the whole of the gate's online defence.

Evidence:

```
src/app/api/auth/route.ts:10-13 `function clientKey(request: Request): string { const fwd = request.headers.get("x-forwarded-for"); return (fwd ? fwd.split(",")[0] : null)?.trim() || "local"; }`
src/app/api/auth/route.ts:20 `if (record && record.count >= MAX_ATTEMPTS && Date.now() < record.until)`
```

**Recommendation.** The recommendation to 'read it from the request's connection info' is not implementable in this stack: NextRequest.ip was removed in Next 15 and there is no supported way to reach the socket address from an App Router route handler in Next 16 (self-hosted). Do it with what is actually available: (a) keep a process-wide failure counter alongside the per-key one and hard-stop at, say, 50 failures per 15 minutes regardless of key, so header rotation still hits a ceiling; (b) only consult X-Forwarded-For when an explicit TRUST_PROXY env var is set, and otherwise use the constant key; (c) add a fixed ~250 ms delay to every failed attempt and lengthen LOCKOUT_MS well past 60 s. If a real per-IP key is wanted, it has to come from a custom server.js wrapping the Next handler (where req.socket.remoteAddress exists), not from a route handler.

### SEC-5 · No rate limiting or in-flight guard on the routes that spend money and hammer third-party APIs

**Severity:** Medium · **Category:** security · **Effort:** small · **Where:** `src/app/api/identify/route.ts:10`

/api/identify sends up to four images to claude-opus-5 with max_tokens 16000 and adaptive thinking on every call, and the optional `hint` string is passed straight into the prompt with no length cap, so one request can cost a large multiple of a normal identification. /api/prices/refresh with no ?stale re-prices the entire collection against up to four providers, and refreshAll has no guard against concurrent invocations -- N parallel POSTs each start their own two-worker pass over every card, which is both a cost multiplier and a fast way to get the free Scryfall/YGOPRODeck/Pokemon TCG endpoints to rate-limit or ban the host. /api/sets/refresh and /api/cards/[id]/price are unbounded in the same way. Only /api/auth has any limiter. In the default no-password configuration anyone who reaches the port can drain the Anthropic budget; via SEC-1 so can any web page the owner visits.

Evidence:

```
src/app/api/identify/route.ts:28 `const identification = await identifyCard(images, typeof body.hint === "string" ? body.hint : undefined);`
src/lib/identify/claude.ts:44-55 `model: claudeModel(), max_tokens: 16000, ... thinking: { type: "adaptive" }`
src/app/api/prices/refresh/route.ts:8 `const result = await refreshAll({ staleHours });`
```

**Recommendation.** Add a small shared in-memory limiter module (the Map-of-counters pattern already in src/app/api/auth/route.ts is enough for a single-process app) and apply it to /api/identify, /api/prices/refresh, /api/sets/refresh and /api/cards/[id]/price -- e.g. 30 identifications/hour, one refreshAll at a time. Give refreshAll a module-level in-flight promise so a second call joins or is rejected rather than starting a parallel pass, and cap `hint` at a few hundred characters in the identify route.

### BUG-1 · Uploaded photos are never garbage-collected, so the data directory and every backup grow without bound

**Severity:** Medium · **Category:** bug · **Effort:** medium · **Where:** `src/lib/images.ts:61`

saveUpload writes a file for every image the browser posts, but the only deletion in the whole codebase is the single card.imagePath removed when that card is deleted. A card keeps only one imagePath, so the back and slab-label photos added through AddCardFlow's addExtraPhoto are orphaned the moment the card is saved; so is every photo whose identification failed, whose scan item was set aside and abandoned, or that the user re-shot. Scan mode makes this routine -- working through a binder produces one file per shutter press. Nothing ever reconciles the uploads directory against the cards table, and buildBackup archives every file it finds, so each backup carries the accumulated garbage and grows monotonically. On the /data volume of a long-running instance this ends as a full disk, which will surface first as a failed restore (see BUG-2).

Evidence:

```
src/lib/images.ts:61 `await fs.writeFile(path.join(uploadsDir(), name), output);`
src/app/api/cards/[id]/route.ts:37 `if (card.imagePath) await deleteUpload(card.imagePath);` -- the only call to deleteUpload in src/
src/components/AddCardFlow.tsx:153-156 `const { uploads } = await api(..."/api/uploads"...); patch(key, (it) => ({ uploads: [...it.uploads, ...names], ... }))`
src/lib/backup.ts:21 `const photoNames = (await fsp.readdir(uploads).catch(() => [] as string[])).filter(isValidUploadName).sort();`
```

**Recommendation.** Store all of a card's photos (add an `images` JSON column, or an uploads table keyed by card id) rather than only the first, and add a sweep -- run it from src/lib/scheduler.ts alongside the price refresh -- that deletes any file in uploadsDir() that is older than, say, 24 hours and is not referenced by any card row. Keeping the age threshold avoids racing an upload that has not been attached to a card yet.

### MISS-1 · No Host-header check, so DNS rebinding turns the unauthenticated default into a full remote read of the collection

**Severity:** Medium · **Category:** security · **Effort:** small · **Where:** `src/proxy.ts:8`

SEC-1 concludes that 'confidentiality is protected (cross-origin reads are blocked by the same-origin policy)'. That holds only while the attacker's page stays on a different origin. Nothing in the app validates the Host header: proxy.ts passes every request through when APP_PASSWORD is unset, no route inspects request.headers.get('host'), and Next is started with HOSTNAME=0.0.0.0 so it answers to any name that resolves to the box. A classic rebinding page (short-TTL name resolving first to the attacker's server, then to 127.0.0.1 or the LAN address) becomes same-origin with the app after the flip and can then read every response: GET /api/backup streams the whole SQLite database and every photo, GET /api/cards returns the collection, GET /api/export returns the CSV. That is a confidentiality loss the CSRF finding explicitly rules out, and it needs no cookie because there is no session in the default configuration. Chromium's Local Network Access work raises the bar for the loopback case but does not cover a LAN-hosted instance reached by name, and it is not a control this app gets to rely on.

Evidence:

```
src/proxy.ts:7-8 `export async function proxy(request: NextRequest) {\n  if (!authEnabled()) return NextResponse.next();` — the only gate, and it is off by default.
`grep -rn "headers.get(\"host\")\|x-forwarded-host" src/` → no matches; the Host header is never read anywhere in the app.
Dockerfile:12 `ENV ... HOSTNAME=0.0.0.0` and compose.yaml:4-5 `ports:\n      - "3000:3000"` — answers on every interface, for any Host.
src/app/api/backup/route.ts:5-14 `export async function GET() { const { filename, stream } = await buildBackup(); return new Response(stream, { headers: { "Content-Type": "application/zip", ... } }); }`
```

**Recommendation.** Add a Host allowlist in src/proxy.ts, before the authEnabled() early return: accept only hosts in a comma-separated ALLOWED_HOSTS env var, defaulting to localhost, 127.0.0.1, [::1] and the machine's own name, and return 403 otherwise. It is a handful of lines in the one file every request already passes through, and unlike the CSRF fix it also protects GET.

### SEC-3 · Alert webhook is an unrestricted blind-SSRF sink (loopback, RFC1918 and cloud metadata all allowed)

**Severity:** Low (reported as medium, adjusted after review) · **Category:** security · **Effort:** small · **Where:** `src/lib/settings.ts:56`

settings.alertWebhookUrl is validated only for the http/https scheme; nothing rejects 127.0.0.1, ::1, 10.0.0.0/8, 192.168.0.0/16 or 169.254.169.254, and the fetch in deliver() uses the default redirect:'follow', so a public URL can 302 into a private one. Every price refresh that raises an alert POSTs JSON to that URL from inside the server's network position. When APP_PASSWORD is unset, PUT /api/settings is unauthenticated, so anyone who can reach the port can point the webhook at an internal service and then call POST /api/prices/refresh to fire it -- a blind SSRF with an attacker-chosen JSON body against anything the container can reach. Even for the owner-only case, the app should not be a general-purpose request forwarder for a value it stores in a database.

Evidence:

```
src/lib/settings.ts:59-61 `const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";`
src/lib/alerts.ts:135-140 `const res = await fetch(settings.alertWebhookUrl, { method: "POST", ... signal: AbortSignal.timeout(10_000) });`
```

**Recommendation.** Resolve the hostname before sending (node:dns/promises lookup) and refuse loopback, link-local, unique-local and RFC1918 addresses, plus non-standard ports; pass `redirect: 'manual'` to fetch and treat a 3xx as a failure. Keep the existing 10s timeout. Document that the webhook is only meant for an external forwarding service.

*Reviewer note (confirmed, severity lowered):* The technical claims are all true and I verified each: webhookUrl() only checks the scheme, and deliver() fetches with the default redirect:'follow', so 127.0.0.1, RFC1918 and 169.254.169.254 are all reachable and a public URL can 302 into a private one. But medium overstates it for this app. This is a deliberate, owner-configured outbound webhook — the feature is 'POST my alerts wherever I say' — and the request is blind (deliver() never returns the response body or status to any caller, only console.error), carries a fixed JSON envelope, and only fires when a real alert is generated by a price refresh. Crucially, the unauthenticated-attacker path the finding leans on requires the attacker to already have full read/write control of the collection via PUT /api/settings, so SSRF is a lateral-movement bonus on top of total application compromise, not an independent hole. Real, worth fixing, low.

### SEC-4 · Request bodies are fully buffered in memory before any size check, on three routes

**Severity:** Low (reported as medium, adjusted after review) · **Category:** security · **Effort:** small · **Where:** `src/app/api/backup/restore/route.ts:12`

Every size limit in the app is enforced after the whole body has already been read into memory. /api/backup/restore calls request.formData() first and only then compares file.size to the 512 MB RESTORE_MAX_BYTES, so a multi-gigabyte multipart body is buffered before it is rejected; even a legitimate 512 MB archive is then held as a Uint8Array, decompressed entry-by-entry into a second full copy in the entries array, and every photo held again in the photos array -- comfortably over 1 GB of resident memory for one request. /api/uploads checks 25 MB x 20 files after formData(), and /api/import parses the JSON body before comparing body.csv.length to 8 MB. With no authentication in the default configuration, one request is enough to OOM the container (which under compose has `restart: unless-stopped`, so the attacker gets a restart loop).

Evidence:

```
src/app/api/backup/restore/route.ts:12-19 `form = await request.formData(); ... if (file.size > RESTORE_MAX_BYTES) return jsonError(...413)`
src/app/api/uploads/route.ts:11-20 `form = await request.formData(); ... const tooBig = files.find((f) => f.size > MAX_BYTES);`
src/app/api/import/route.ts:15-20 `body = (await request.json()) ... if (body.csv.length > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);`
src/lib/backup.ts:136-152 `const entries = await readZip(archive, RESTORE_LIMITS); ... photos.push({ name: photo, data: entry.data });`
```

**Recommendation.** The Content-Length precheck is right but must tolerate its absence rather than 413 on it: a chunked request has no Content-Length, and rejecting that would break legitimate clients. Use `const len = Number(request.headers.get('content-length')); if (Number.isFinite(len) && len > MAX) return jsonError(..., 413);` as a cheap early exit, and keep the existing post-parse check as the real enforcement. For restore, the higher-value change is to lower RESTORE_MAX_BYTES to something a 1-2 GB container can actually hold (64-128 MB) and to write each entry to the staging directory as it is read in readZip instead of accumulating a photos array.

*Reviewer note (confirmed, severity lowered):* The mechanics are correct and I confirmed all three sites: every size check runs after the body is fully materialised, and App Router route handlers have no built-in body-size limit (unlike the old Pages API bodyParser.sizeLimit), so nothing truncates the upload first. restoreBackup then holds the archive, the decoded entries array and the photos array simultaneously, which is genuinely >1 GB resident for a legal 512 MB archive. But the entire impact is memory exhaustion of a single-user self-hosted process that compose restarts automatically; there is no data loss, no disclosure and no privilege gain, and the same owner can trivially do it by accident. Low. One factual correction: the /api/import check is `body.csv.length > MAX_BYTES`, which counts UTF-16 code units, not bytes, so the effective ceiling is up to 4x the intended 8 MB for non-ASCII content.

### SEC-6 · sharp decodes untrusted images with error checks disabled and no pixel budget

**Severity:** Low (reported as medium, adjusted after review) · **Category:** security · **Effort:** trivial · **Where:** `src/lib/images.ts:56`

saveUpload accepts anything whose declared type starts with image/ and hands it to sharp with `failOn: "none"`, which disables libvips' truncation and corruption checks, and never sets limitInputPixels. sharp's default ceiling is ~268 megapixels, so a ~25 MB crafted PNG (well within MAX_BYTES) can expand to roughly a gigabyte of raw pixels; each upload is then decoded twice more (dominantColor re-decodes the output, prepareForVision re-decodes for the vision call). The browser client posts each file as its own request in parallel (AddCardFlow addFiles uses Promise.all over the picked files), so a dozen files means a dozen concurrent decodes. Combined with the absent authentication this is a straightforward memory/CPU exhaustion vector, and disabling failOn also widens the surface of the image parsers for malformed input.

Evidence:

```
src/lib/images.ts:50-60 `if (!ALLOWED_IMAGE_TYPES[file.type] && !file.type.startsWith("image/")) ... const output = await sharp(input, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, ... })`
src/lib/images.ts:33 `const img = sharp(buffer, { failOn: "none" }).rotate();`
src/components/AddCardFlow.tsx:107-110 `await Promise.all(fresh.map(async (item, i) => { const fd = new FormData(); fd.append("files", images[i]); ...`
```

**Recommendation.** Pass an explicit budget to every sharp() call: `sharp(input, { failOn: 'truncated', limitInputPixels: 50_000_000, sequentialRead: true })` (50 MP is far beyond any phone photo). Call `sharp.concurrency(1)` once at module load so libvips does not spawn a thread per core per decode, and reuse the single decoded pipeline for the resize and the dominant-colour sample instead of re-decoding the JPEG a second time.

*Reviewer note (confirmed, severity lowered):* The code is as quoted: three separate sharp() pipelines with `failOn: "none"` and no limitInputPixels, so sharp's ~268 MP default ceiling applies and a small crafted PNG really can expand to roughly a gigabyte of raw pixels, decoded up to three times per upload (saveUpload, then dominantColor on the re-encoded output, then prepareForVision on identify). The severity should be low, though: the outcome is CPU/memory exhaustion of a single-user self-hosted process, with no disclosure or corruption, and the container restarts. One correction to the reasoning: `failOn: 'none'` does not meaningfully 'widen the surface of the image parsers' — it suppresses libvips warnings/errors for truncated or corrupt input so partial images still decode; it is a robustness choice. The actual defect is the missing pixel budget, and `failOn` matters only in that it keeps a malformed file in the pipeline rather than rejecting it early.

### SEC-7 · Docker publishes the unauthenticated app on every interface

**Severity:** Low (reported as medium, adjusted after review) · **Category:** security · **Effort:** trivial · **Where:** `compose.yaml:4`

compose.yaml maps `3000:3000`, which binds 0.0.0.0 on the host, and the image sets HOSTNAME=0.0.0.0. Nothing in the image or the compose file requires APP_PASSWORD, and authEnabled() silently returns false when it is unset, so `docker compose up` on a laptop or NAS with a copied .env that lacks APP_PASSWORD publishes GET /api/backup (the entire database plus every photo), DELETE /api/cards/[id], POST /api/backup/restore and PUT /api/settings to the whole LAN with no warning anywhere in the startup path. The README's 'private network' framing assumes a network the reader trusts; the failure is silent either way.

Evidence:

```
compose.yaml:4-5 `ports:\n      - "3000:3000"`
Dockerfile:12 `ENV NODE_ENV=production ... HOSTNAME=0.0.0.0`
src/lib/auth.ts:13-15 `export function authEnabled(): boolean { return Boolean(process.env.APP_PASSWORD); }`
```

**Recommendation.** Change the compose mapping to `127.0.0.1:3000:3000` and document exposing it deliberately. Log a one-line warning at boot from src/instrumentation.ts when authEnabled() is false (e.g. 'No APP_PASSWORD set - every route is open to anyone who can reach this port'), so the state is visible rather than assumed.

*Reviewer note (confirmed, severity lowered):* Both facts are correct (compose maps 3000:3000, which binds 0.0.0.0 on the host, and the image sets HOSTNAME=0.0.0.0), and authEnabled() really does fail open silently. But medium overstates it: publishing on all interfaces is Docker Compose's ordinary behaviour for a self-hosted service, and the README documents the trade-off explicitly rather than hiding it — 'Leave it unset and there is no login at all, which is fine on a machine only you can reach' plus 'meant for your own machine or private network'. So this is a hardening/defaults improvement (bind to loopback, warn at boot), not an undisclosed exposure. The genuinely valuable half of the recommendation is the startup warning, since that is the part the README cannot do.

### SEC-8 · No security headers or CSP on any response

**Severity:** Low · **Category:** security · **Effort:** small · **Where:** `next.config.ts:3`

next.config.ts defines no headers(), and no route sets security headers of its own, so nothing sends Content-Security-Policy, X-Content-Type-Options, Referrer-Policy or frame-ancestors. The app serves user-supplied binary content from its own origin (/api/uploads/[name] with a hardcoded image/jpeg type), renders href and src values that came from third-party APIs, and can be framed by any page. A CSP with `default-src 'self'` plus an explicit img-src would be the backstop for the third-party-URL issue below and for anything that slips past React's escaping.

Evidence:

```
next.config.ts:3-10 `const nextConfig: NextConfig = { serverExternalPackages: [...], ...(process.env.BUILD_STANDALONE ? { output: "standalone" } : {}) };` -- no headers() key
src/app/api/uploads/[name]/route.ts:8-12 `headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" }`
```

**Recommendation.** Add an async headers() to next.config.ts applying to '/(.*)': `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a CSP such as `default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (Next's inline bootstrap needs 'unsafe-inline' unless you wire up a nonce). Add nosniff to the uploads route response too.

### SEC-9 · Session cookie loses its Secure flag behind a TLS-terminating reverse proxy

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `src/app/api/auth/route.ts:42`

The cookie's secure attribute is derived from `request.url.startsWith("https://")`. In the deployment the README suggests for remote access -- Caddy/nginx/Tailscale terminating TLS in front of `next start` -- the origin request arrives over plain HTTP, so the 30-day session cookie is issued without Secure and any subsequent plaintext request to the same host (a typed http:// URL, a downgrade, a captive portal) sends the session token in the clear. There is no way to force it on.

Evidence:

```
src/app/api/auth/route.ts:39-45 `response.cookies.set(SESSION_COOKIE, await createToken(), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), path: "/", maxAge: SESSION_DAYS * 86400 });`
```

**Recommendation.** Keep the env override, drop the reliance on request.url as the primary signal: `const secure = process.env.COOKIE_SECURE === '1' || request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https://')`, documented in .env.example. Do not add the __Host- prefix as suggested — __Host- requires Secure to be set on every issue, so it would silently break sign-in for the plain-HTTP localhost deployment the README recommends first.

### SEC-10 · Session signing key defaults to a constant prefix plus the password, and tokens carry no session identity

**Severity:** Low · **Category:** security · **Effort:** small · **Where:** `src/lib/auth.ts:20`

When APP_SECRET is unset the HMAC key is the literal string `collectcollect:` concatenated with APP_PASSWORD. A token is `${expires}.${hmac(String(expires), secret)}` -- the signed message is a known plaintext -- so anyone who obtains one cookie (a shared browser, a proxy log, a backup of browser state) can mount an offline dictionary attack against the password with no rate limiting at all, and on success both learns the login password and can mint tokens with any expiry. The token also contains no per-session nonce, so DELETE /api/auth only clears the client's copy: a captured token stays valid for the rest of its 30 days and cannot be revoked short of changing the password.

Evidence:

```
src/lib/auth.ts:17-21 `function secret(): string { return process.env.APP_SECRET || `collectcollect:${process.env.APP_PASSWORD ?? ""}`; }`
src/lib/auth.ts:51-54 `const expires = now + SESSION_DAYS * 86400_000; return `${expires}.${await hmac(String(expires), secret())}`;`
```

**Recommendation.** Generate and persist a random APP_SECRET when one is not configured (e.g. write 32 random bytes to a file in DATA_DIR on first boot) rather than deriving the key from the password, and include a random per-token identifier in the signed payload so sign-out can record it in a small revocation set. Update .env.example to describe APP_SECRET as recommended rather than optional.

### SEC-11 · URLs from third-party APIs and from restored databases are rendered into href/src without the guard the write path applies

**Severity:** Low · **Category:** security · **Effort:** small · **Where:** `src/components/PricePanel.tsx:84`

normalizeInput carefully restricts referenceImageUrl to http(s) on the way in (src/lib/cards.ts:97-107), but nothing revalidates on the way out and two other paths bypass that guard entirely. Price quotes are stored verbatim in the snapshot JSON and PricePanel renders `<a href={q.url}>` where q.url is whatever the provider returned (best.ygoprodeck_url, card.scryfall_uri, best.tcgplayer?.url); set checklists store imageUrl from the same responses and the set page renders it as an <img src>. A restored backup is a third path: restoreBackup validates entry names but never inspects the rows of the database it installs, so a crafted archive can set reference_image_url and accent_color to anything and CardDetail will render them into an href and a CSS custom property. The realistic trigger is a compromised or hijacked upstream API rather than a random attacker, and there is no CSP to fall back on (SEC-8).

Evidence:

```
src/components/PricePanel.tsx:83-86 `{q.url ? (<a href={q.url} target="_blank" rel="noreferrer" ...>{q.sourceLabel}</a>) : ...}`
src/lib/pricing/providers/ygoprodeck.ts:91 `url: best.ygoprodeck_url ?? `https://ygoprodeck.com/card/?search=${encodeURIComponent(best.name)}`,`
src/app/sets/[game]/[name]/page.tsx:56 `<img src={c.imageUrl} alt="" ... />`
src/components/CardDetail.tsx:192 `<a href={card.referenceImageUrl} target="_blank" rel="noreferrer" ...>`
```

**Recommendation.** Export the existing httpUrl() helper from src/lib/cards.ts (or move it to src/lib/format.ts) and apply it at every render site that takes an outside URL -- PricePanel's q.url, the checklist imageUrl, and CardDetail's referenceImageUrl -- returning null instead of rendering the element. Normalise provider urls in each provider adapter as they are parsed, so the bad value never reaches the database.

### SEC-12 · The identification blob is stored from the client without validation

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `src/lib/cards.ts:163`

Every other field in normalizeInput is type-checked and coerced, but `identification: input.identification ?? null` passes the client's object straight to JSON.stringify and into the cards table. POST /api/cards, /api/cards/intake and PATCH /api/cards/[id] therefore accept an arbitrary JSON document of arbitrary size in that field, which is stored, returned to every client that lists cards, and read back by alertsForRefresh (which dereferences identification.condition_assessment.estimated_grade_high without checking its shape). It is not an XSS -- React escapes it -- but it is unvalidated persistence of attacker-shaped data on an unauthenticated route, and it lets a caller inflate the database and every backup without limit.

Evidence:

```
src/lib/cards.ts:163 `identification: input.identification ?? null,`
src/lib/alerts.ts:104-105 `const assess = card.identification?.condition_assessment ?? null; const expected = assess?.estimated_grade_high ?? assess?.estimated_grade_low ?? null;`
```

**Recommendation.** Reuse the zod schema that already exists for this exact shape: `identification: input.identification ? IdentificationSchema.partial().parse(input.identification) : null` in normalizeInput (or a dedicated lenient variant that tolerates rows written before condition_assessment existed). That is one import and one line, and it makes the alerts code's optional chaining honest.

### SUP-1 · GitHub Actions are referenced by mutable tags and the workflow grants default token permissions

**Severity:** Low · **Category:** supply-chain · **Effort:** trivial · **Where:** `.github/workflows/ci.yml:13`

All three actions (actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4) are pinned to floating major-version tags, which a compromise of the action repository can repoint; the workflow runs on every push to every branch and on pull_request, and declares no permissions block, so the job's GITHUB_TOKEN carries the repository default rather than read-only. Nothing secret is used by this workflow today, which is what keeps this low, but the combination is the standard path from a compromised action to a repository write.

Evidence:

```
.github/workflows/ci.yml:13 `- uses: actions/checkout@v4`
.github/workflows/ci.yml:15 `- uses: actions/setup-node@v4`
.github/workflows/ci.yml:44 `uses: actions/upload-artifact@v4`
(no `permissions:` key anywhere in the file)
```

**Recommendation.** Pin each action to a full commit SHA with the version in a trailing comment, and add `permissions: contents: read` at the workflow level (raising it per-job only where a job needs more). Dependabot with the github-actions ecosystem enabled keeps the SHAs current.

### BUG-2 · A restore that fails part way leaves the app with no database and no photos

**Severity:** Low · **Category:** reliability · **Effort:** medium · **Where:** `src/lib/backup.ts:179`

restoreBackup moves the live database, its WAL siblings and every photo into the timestamped `replaced-*` folder before it writes anything back, and there is no free-space check first -- yet a restore transiently needs roughly twice the collection's size on the same filesystem, so ENOSPC is the most likely failure and it is most likely to strike midway through the photo loop. The catch block does not attempt to move anything back; it throws a message naming the folder and leaves the finally block to unlock the database, after which getDb() opens a brand-new empty database at the live path. The user is left with an app that says the collection is empty and a folder they must reassemble by hand. The same shape applies to any EACCES/EIO in the loop.

Evidence:

```
src/lib/backup.ts:193-206 `for (const name of await fsp.readdir(liveDir)) { ... await fsp.rename(...) } ... for (const photo of photos) await fsp.writeFile(path.join(uploads, photo.name), photo.data);`
src/lib/backup.ts:207-212 `} catch (e) { throw new Error(`The restore failed part way through: ... Your previous collection was moved to ${aside} and can be put back by hand.`); }`
```

**Recommendation.** Write the new collection into a sibling staging directory inside dataDir() first, then swap directories with renames once everything is on disk, so the only window is between two renames. Failing that, add a rollback in the catch block that renames everything in `aside` back to its original location, and check available space (fs.statfs) against archive size x 2 before starting.

### BUG-3 · The login page renders the whole signed-in nav, including the unread alert count

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/app/layout.tsx:22`

RootLayout calls unreadCount() unconditionally and renders the full navigation, so an unauthenticated visitor to /login sees Portfolio / Collection / Sets / Grading / Alerts / Report / Settings links, a 'Sign out' button (authEnabled() is true on that page by definition) and the numeric badge of how many unread alerts the collection has. The links all bounce straight back to /login, so it reads as broken, and the badge is a small unauthenticated information disclosure from a page whose entire job is to be reachable without a session. It also means every request to the login page opens the SQLite database, so /login returns a 500 while a restore holds the lock.

Evidence:

```
src/app/layout.tsx:22 `const unread = unreadCount();`
src/app/layout.tsx:45-52 `<Link href="/alerts" ...>Alerts{unread > 0 && (<span ...>{unread > 99 ? "99+" : unread}</span>)}</Link>`
src/proxy.ts:5 `const PUBLIC = ["/login", "/api/auth"];`
```

**Recommendation.** Have the layout check for a session before rendering the nav: read the cc_session cookie with `cookies()` and call verifyToken(), and when auth is enabled but the visitor has no valid session render only the header logo and children (skipping unreadCount() entirely). That also keeps the database out of the unauthenticated request path.

### BUG-4 · Object URLs for scanned photos are never revoked

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/components/ScanFlow.tsx:204`

Both capture flows create a blob URL per photo for the thumbnail and never call URL.revokeObjectURL, and ScanFlow additionally keeps the original File object on every item for the life of the page. Scan mode is explicitly designed for working through a binder or a stack, one full-resolution phone photo at a time, so a long session accumulates every captured image in memory twice over (the File plus the retained blob) even after the card has been saved and its thumbnail switched to /api/uploads/. On a phone -- the target device -- this is how the tab gets killed mid-stack.

Evidence:

```
src/components/ScanFlow.tsx:204 `preview: URL.createObjectURL(file),`
src/components/AddCardFlow.tsx:96 `previews: [URL.createObjectURL(f)],`
(no occurrence of revokeObjectURL anywhere in src/)
```

**Recommendation.** Revoke as soon as the server-side preview replaces the local one -- in ScanFlow's processOne, after patching the item with the upload name, call URL.revokeObjectURL(item.preview) and switch preview to `/api/uploads/${upload.name}`; drop the retained File at the same point. Add a component-unmount effect that revokes anything still outstanding.

### MISS-2 · CSV import runs an unindexed full-table scan per row, synchronously, with no cap on rows

**Severity:** Low · **Category:** bug · **Effort:** medium · **Where:** `src/lib/import.ts:193`

applyImport loops over every parsed row and calls intakeCard, which opens a better-sqlite3 transaction and calls findSimilar. findSimilar's query filters on `lower(trim(name))`, an expression with no index (the schema declares indexes only on price_snapshots, sales, submission_cards and alerts), so SQLite scans the entire cards table once per imported row, over a table that is growing as the import proceeds. Nothing caps the row count: /api/import accepts up to 8 MB of CSV, which is on the order of 10^5 rows, giving ~10^10 row comparisons. Because better-sqlite3 is synchronous and this all happens inside one request handler, the Node event loop is blocked for the whole import — the server answers nothing else, including the health of the page that started it, and there is no progress or cancellation. In the default configuration the route is unauthenticated, so it is also a one-request hang. Even a legitimate 20k-row collection import will lock the app up for a long time.

Evidence:

```
src/lib/import.ts:193-210 `export function applyImport(preview: ImportPreview): ImportResult { ... for (const row of preview.rows) { ... const outcome = intakeCard(row.input); ... } }` — no row cap, no batching.
src/lib/cards.ts:227-229 `const rows = getDb()\n    .prepare("SELECT * FROM cards WHERE game = ? AND lower(trim(name)) = ? ORDER BY updated_at DESC")\n    .all(input.game, name) as CardRow[];`
src/lib/db.ts:55,68,93,112 — the only CREATE INDEX statements; none covers cards(game, name).
src/app/api/import/route.ts:6,20 `const MAX_BYTES = 8 * 1024 * 1024;` / `if (body.csv.length > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);`
```

**Recommendation.** Add a stored normalised name column with an index (e.g. `name_key TEXT` written in createCard/updateCard as `lower(trim(name))`, plus `CREATE INDEX idx_cards_lookup ON cards(game, name_key)`) and have findSimilar match on it; add a hard row cap to previewImport (a few thousand) and return the count that was skipped, so a pathological file is refused rather than run. Wrapping applyImport's whole loop in one transaction also removes 10^5 fsyncs.

### MISS-3 · Restore's `replaced-*` folders are never cleaned up or surfaced, so each restore permanently doubles the data directory

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/lib/backup.ts:172`

Every restore renames the live database, its WAL siblings and the entire uploads directory into a fresh `replaced-<timestamp>` folder inside dataDir(), and nothing ever removes it: there is no sweep, no retention limit, no UI that lists these folders, and the only mention of them is in the RestoreResult.movedAsideTo string. So the disk cost of a restore is permanent and cumulative — three restores of a 2 GB collection leave 8 GB on the volume — and the app will never tell the owner that space is being held. There are two consequences beyond disk: (a) it makes BUG-2's most likely failure (ENOSPC part way through a restore) progressively more likely with each successful restore, since a restore transiently needs roughly twice the collection's size; and (b) it is a data-retention surprise, because a collection the owner deliberately replaced (including every photo) stays on disk indefinitely with no indication. In the default unauthenticated configuration, repeated calls to POST /api/backup/restore are also a straightforward way to fill the volume for good.

Evidence:

```
src/lib/backup.ts:171-172 `const stamp = new Date().toISOString().replace(/[:.]/g, "-");\n  const aside = path.join(root, \`replaced-${stamp}\`);`
src/lib/backup.ts:198-203 `const uploads = uploadsDir();\n    const oldUploads = path.join(aside, "uploads");\n    await fsp.mkdir(oldUploads, { recursive: true });\n    for (const name of await fsp.readdir(uploads)) {\n      await fsp.rename(path.join(uploads, name), path.join(oldUploads, name));\n    }`
`grep -rn "replaced-" src/` → only src/lib/backup.ts:172 and the message at :211; nothing deletes or lists them.
src/lib/backup.ts:93-105 `backupSummary()` reports photos/databaseBytes/photoBytes only — the replaced folders are invisible to the Settings page.
```

**Recommendation.** Report the replaced folders in backupSummary() (count and total bytes) and show them on the Settings page with a delete action, and/or prune to the most recent N on each restore. Also check free space (fs.statfs on dataDir) against archive size x 2 before starting, which is the same precondition BUG-2 needs.

### MISS-4 · The upload type allowlist is inert: any `image/*` the client declares is accepted, including SVG

**Severity:** Low · **Category:** security · **Effort:** small · **Where:** `src/lib/images.ts:50`

ALLOWED_IMAGE_TYPES looks like an allowlist but the condition short-circuits on the second clause, so anything whose declared type starts with `image/` passes and the map is never consulted for a decision. The declared type is the client's multipart Content-Type, entirely attacker-chosen. The practically interesting case is `image/svg+xml`: sharp's prebuilt binaries include the librsvg loader, so an SVG upload is handed to a vector parser rather than a raster decoder, and SVG is the one input format where the file's declared dimensions and its parse cost are decoupled from its byte size. That is a different parser surface from the JPEG/PNG/WebP/HEIC set the app believes it accepts, and it is reached three times per upload (saveUpload, dominantColor, prepareForVision). It is also inconsistent with the rest of the file, which is otherwise strict — upload names are UUID-validated and uploadPath() throws rather than joining an unvalidated name.

Evidence:

```
src/lib/images.ts:7-13 `export const ALLOWED_IMAGE_TYPES: Record<string, string> = {\n  "image/jpeg": "jpg",\n  "image/png": "png",\n  "image/webp": "webp",\n  "image/heic": "heic",\n  "image/heif": "heif",\n};`
src/lib/images.ts:50-52 `if (!ALLOWED_IMAGE_TYPES[file.type] && !file.type.startsWith("image/")) {\n    throw new Error(\`Unsupported file type: ${file.type || "unknown"}\`);\n  }` — the `||`-style short circuit means image/svg+xml, image/tiff, image/gif etc. all pass.
src/lib/images.ts:56 `const output = await sharp(input, { failOn: "none" })` — no `{ animated: false }`, no format restriction.
src/app/api/uploads/route.ts:16 `const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);` — the route does no type check of its own.
```

**Recommendation.** Decide from the decoded bytes rather than the declared type: drop the `|| startsWith('image/')` escape hatch so ALLOWED_IMAGE_TYPES is actually authoritative, and after `sharp(input, ...)` check `(await pipeline.metadata()).format` against the same set before writing anything. Pair it with the `limitInputPixels` fix from SEC-6, which is the other half of the same pipeline.

## Upgrades

| Value | Effort | Upgrade | Now | Move to |
|---|---|---|---|---|
| high | trivial | Docker image cannot build: it copies a public/ directory that does not exist | Dockerfile line `COPY --from=build --chown=node:node /app/public ./public`; `git ls-files public` returns nothing and there is no public/ on disk. Next does not create it. CI never runs `docker build`, so the break is invisible. | Either add a real `public/` (favicon.ico, icon-192/512.png, apple-touch-icon) — which the app needs anyway — or drop the COPY. Then add a `docker build .` job to .github/workflows/ci.yml so the documented `docker compose up --build` path stays tested. |
| high | small | No same-origin guard on state-changing API routes | src/proxy.ts only checks the session cookie, and only when APP_PASSWORD is set. With no password (the documented default) every mutating route is open to any origin. A cross-origin `fetch` with `Content-Type: text/plain` carrying a JSON body is a CORS-simple request with no preflight, and `request.json()` parses it happily — so any page the owner visits can POST /api/cards, DELETE /api/cards/:id, or POST /api/backup/restore against http://localhost:3000. | In proxy.ts, for methods other than GET/HEAD, require `Sec-Fetch-Site: same-origin` (or an `Origin` header matching `request.nextUrl.origin`) and return 403 otherwise. Cheap, no state, and closes the hole whether or not a password is set. Cover it with a case in e2e/auth.spec.ts. |
| high | small | No security response headers | next.config.ts sets only `serverExternalPackages` and conditional standalone output; there is no `headers()` block, so the app ships with no CSP, no frame-ancestors, no Referrer-Policy, no X-Content-Type-Options and no Permissions-Policy. | Add a `headers()` entry returning `Content-Security-Policy` (self + `img-src 'self' data: https:` for provider reference images), `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy: camera=(self), geolocation=(), microphone=()` — scan mode needs camera, nothing else does. Check the exact `headers()` shape against node_modules/next/dist/docs before writing it, per AGENTS.md. |
| high | small | Login rate limiter keys on a header the client chooses | src/app/api/auth/route.ts `clientKey()` reads `x-forwarded-for` and falls back to the literal "local". Anyone can rotate that header per request and never hit MAX_ATTEMPTS. The `attempts` Map is also keyed by that attacker-supplied string and is never pruned, so it grows without bound. | Key on something the caller cannot pick — the socket address, or a global counter when no trusted proxy is configured — and only honour X-Forwarded-For when an explicit `TRUSTED_PROXY=1` says the app sits behind one. Add a global attempt ceiling as a backstop and evict entries whose lockout has expired. (This is exactly the invariant the sibling tvsham repo records as "bill callers by something they cannot choose".) |
| high | small | Node 22 is in maintenance; no engines field or .nvmrc | CI `node-version: 22`, Dockerfile `node:22-bookworm-slim`, devDependency `@types/node: ^22.20.1`. Node 22 entered maintenance in Oct 2025 (EOL Apr 2027); Node 24 "Krypton" is the active LTS until Oct 2026. package.json has no `engines` and the repo has no .nvmrc, so nothing pins the runtime. | Move CI and the Dockerfile to `node:24` and bump `@types/node` to ^24. Add `"engines": { "node": ">=22.12" }` to package.json and a `.nvmrc` containing `24` so local, CI and image agree. Revisit for Node 26 after it becomes LTS in Oct 2026. |
| high | medium | TypeScript is a major version behind and tsconfig is at baseline strictness | devDependency `typescript: ^5` (5.9.3 resolved); latest is 7.0.2 (6.x also published). tsconfig.json has `strict: true` but not `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` or `verbatimModuleSyntax`, and targets ES2017 despite a Node 22+ server and evergreen browsers. | Move to TypeScript 7 (via 6.x if the jump needs staging) and turn on `noUncheckedIndexedAccess` first — the chart code indexes arrays constantly (`coords[index]`, `xs[index!]`, `points[index]`, `series[series.length - 1]`) and several call sites already reach for `!`, which is where this flag pays. Then `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Raise `target` to ES2022. Expect a batch of small fixes, all mechanical. |
| high | small | Identification runs at default effort with no usage accounting | src/lib/identify/claude.ts sends `output_config: { format: zodOutputFormat(...) }` with no `effort`, so every card runs at the default `high` on claude-opus-5 with adaptive thinking and max_tokens 16000. `response.usage` is discarded, so the app that spends real money per photo can never say how much. Scan mode fires two of these concurrently for as long as the owner keeps shooting. | Add `effort` to the existing `output_config` object (`{ effort: process.env.CLAUDE_EFFORT ?? "medium", format: ... }`) and measure against a handful of known cards — vision extraction from a clear photo is not a task that needs `high`. Record `response.usage.input_tokens`/`output_tokens` per identification so the spend feature below has something to read. Keep the model default at claude-opus-5; document the Sonnet 5 / Haiku 4.5 tradeoff for bulk scanning in .env.example instead of changing it silently. |
| medium | small | ESLint 9 is now the maintenance line | devDependency `eslint: ^9` (9.39.5); the npm `latest` tag is 10.10.0 and 9.x is published under the `maintenance` tag. `eslint-config-next` is pinned to 16.3.4 alongside it. | Upgrade to ESLint 10 once `eslint-config-next` for the installed Next version declares support (check its peerDependencies). The flat config in eslint.config.mjs is already the v9+ shape, so the migration should be limited to the dependency bump. |
| medium | trivial | GitHub Actions unpinned, no permissions block, no concurrency group | .github/workflows/ci.yml uses `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` — 0 of 3 pinned to a commit SHA. There is no top-level `permissions:` (so the token gets the repo default), and `on: push: branches: ["**"]` plus `on: pull_request` means every PR branch runs the whole 20-minute suite twice. | Pin each action to a full commit SHA with the version in a trailing comment; add `permissions: { contents: read }` at workflow level; add `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`. Also cache the Playwright browser download (key on the @playwright/test version) — right now Chromium is re-downloaded on every run. |
| medium | trivial | No Dependabot or Renovate | No .github/dependabot.yml and no renovate.json. Dependencies happen to be current today (next 16.3.4, react 19.2.8, vitest 5.0.0, zod 4.5.4, @anthropic-ai/sdk 0.124.0, better-sqlite3 13.0.3, sharp 0.35.4 are all at npm `latest`), which is exactly the state that quietly decays. | Add .github/dependabot.yml with `npm` (weekly, grouped minor+patch) and `github-actions` (weekly) ecosystems. The github-actions updater is what keeps SHA pins from going stale once you pin them. |
| medium | trivial | No npm audit step in CI | CI runs lint, typecheck, unit tests, build and e2e but never audits. The current audit is clean, so a regression would arrive silently. | Add `npm audit --audit-level=high` as a step after `npm ci`. Keep it non-blocking initially (`continue-on-error: true`) if a transitive advisory would otherwise stall unrelated work. |
| medium | trivial | Compose publishes on all interfaces with no healthcheck | compose.yaml maps `"3000:3000"`, which binds 0.0.0.0 — the app is reachable from the whole LAN, and by default it has no password. There is no `HEALTHCHECK` in the Dockerfile and no `healthcheck:` in compose. | Default the mapping to `"127.0.0.1:3000:3000"` and document in the README how to widen it deliberately (and to set APP_PASSWORD when doing so). Add a `HEALTHCHECK` hitting a cheap route so `restart: unless-stopped` can act on a wedged process rather than only a crashed one. |
| medium | small | No error, not-found or loading boundaries in the app router | src/app has no error.tsx, global-error.tsx, not-found.tsx or loading.tsx. Every page is `dynamic = "force-dynamic"` and reads SQLite synchronously in the server component; `getDb()` deliberately throws while a restore holds the lock, and `listSnapshots` calls unguarded `JSON.parse`. Either produces Next's default error screen with no way back. | Add src/app/error.tsx with a reset button and a plain-English message, src/app/global-error.tsx, and src/app/not-found.tsx (currently `notFound()` is called from three pages with nothing custom behind it). A `loading.tsx` on the portfolio route also helps, since that page does the most work. |
| medium | small | No favicon, icons or web app manifest — and the app is used from a phone | No public/ directory at all; layout.tsx metadata sets only title and description. Scan mode calls `navigator.mediaDevices.getUserMedia` with `facingMode: environment`, so the intended device is a phone, but the app cannot be added to a home screen and shows a default browser icon. | Add public/ with favicon.ico, icon-192.png, icon-512.png (maskable) and apple-touch-icon.png, plus `app/manifest.ts` (name, short_name, `display: standalone`, `theme_color`, `background_color` matching globals.css) and a `viewport` export with `themeColor`. This also fixes the Dockerfile COPY above. A service worker is not needed — the app is useless offline by design. |
| medium | medium | Every image is a raw <img> with an eslint-disable and no intrinsic size | Eight `// eslint-disable-next-line @next/next/no-img-element` comments across AddCardFlow, Portfolio (2), ScanFlow, CardDetail, CardTile, report/page and sets/[game]/[name]/page. None of the images carry width/height, so every grid, the report and the top-holdings list shift layout as photos load; `loading="lazy"` is applied inconsistently (present on tiles and holdings, absent on the card detail hero and the add-flow previews). | Either adopt `next/image` — uploads are all 3:4 JPEGs re-encoded at a known max, and `images.remotePatterns` can cover the provider reference URLs — or keep <img> but add explicit `width`/`height` (or a CSS aspect-ratio box), `decoding="async"` and consistent `loading="lazy"`, and move the rule to an `overrides` block in eslint.config.mjs instead of eight inline disables. |
| medium | trivial | No LICENSE, SECURITY.md, CHANGELOG or CONTRIBUTING | Repo root has README.md, AGENTS.md and CLAUDE.md only. The README documents a password gate, a restore path that validates untrusted archives, and an open-redirect fix in the git history — this project has a security surface worth having a reporting channel for. | Add a LICENSE (MIT or AGPL depending on intent — without one nobody may legally use it), a short SECURITY.md naming a contact and the trust model ("single-user, meant for a private network; the restore endpoint accepts an archive that replaces the whole collection"), and a CHANGELOG.md — the 21 commit subjects are already written as changelog entries. |
| medium | small | Playwright behind, and no accessibility assertions in the e2e suite | `@playwright/test: ^1.56.1` against 1.63.0 latest. The suite covers add/merge/scan/sale/submission/backup/import/auth well but never asserts that controls have accessible names or that contrast holds — a check the sibling repos (ambientnoiser, randostats) make explicitly. | Bump Playwright, then add an `@axe-core/playwright` pass over /, /collection, /cards/[id], /submissions and /settings asserting no serious or critical violations. The charts are the likely first failures: PortfolioChart and OutlookChart expose only `role="img"` + a static aria-label, and the crosshair readout is a `pointer-events-none` div with no live region. |
| low | small | No test coverage reporting | vitest.config.ts sets only `include` and `environment`. Coverage is never measured, so the gaps listed under CODE_QUALITY are invisible. | Add `test.coverage` with the v8 provider, `include: ['src/lib/**']`, text + lcov reporters and a floor (start at whatever the current number is, then ratchet). Print the summary in CI. Excluding src/app and src/components keeps the signal on the logic that actually has tests. |

- **Docker image cannot build: it copies a public/ directory that does not exist** (high value, trivial, `Dockerfile`). undefined
- **No same-origin guard on state-changing API routes** (high value, small, `src/proxy.ts`). undefined
- **No security response headers** (high value, small, `next.config.ts`). undefined
- **Login rate limiter keys on a header the client chooses** (high value, small, `src/app/api/auth/route.ts`). undefined
- **Node 22 is in maintenance; no engines field or .nvmrc** (high value, small, `.github/workflows/ci.yml`). undefined
- **TypeScript is a major version behind and tsconfig is at baseline strictness** (high value, medium, `tsconfig.json`). undefined
- **Identification runs at default effort with no usage accounting** (high value, small, `src/lib/identify/claude.ts`). undefined
- **ESLint 9 is now the maintenance line** (medium value, small, `package.json`). undefined
- **GitHub Actions unpinned, no permissions block, no concurrency group** (medium value, trivial, `.github/workflows/ci.yml`). undefined
- **No Dependabot or Renovate** (medium value, trivial, `.github/dependabot.yml`). undefined
- **No npm audit step in CI** (medium value, trivial, `.github/workflows/ci.yml`). undefined
- **Compose publishes on all interfaces with no healthcheck** (medium value, trivial, `compose.yaml`). undefined
- **No error, not-found or loading boundaries in the app router** (medium value, small, `src/app/error.tsx`). undefined
- **No favicon, icons or web app manifest — and the app is used from a phone** (medium value, small, `src/app/layout.tsx`). undefined
- **Every image is a raw <img> with an eslint-disable and no intrinsic size** (medium value, medium, `src/components/CardTile.tsx`). undefined
- **No LICENSE, SECURITY.md, CHANGELOG or CONTRIBUTING** (medium value, trivial, `LICENSE`). undefined
- **Playwright behind, and no accessibility assertions in the e2e suite** (medium value, small, `playwright.config.ts`). undefined
- **No test coverage reporting** (low value, small, `vitest.config.ts`). undefined

## Features worth adding

- **Background price refresh with progress, instead of one blocking request** (high value, medium). POST /api/prices/refresh currently runs `refreshAll()` for the entire collection inside a single HTTP request at concurrency 2, and Portfolio.tsx awaits it with a spinner. At 200 cards and four providers that is minutes of a held connection, and two clicks start two overlapping passes that both write snapshots. Turn it into a job: a module-level singleton in src/lib/pricing/refresh.ts holding `{ id, total, done, unpriced, failed, startedAt, finishedAt }`, POST starting it and returning 202 with the job id (409 if one is already running), and GET /api/prices/refresh returning the record. Portfolio's "Refresh all prices" button then polls and shows "41 of 180". The same job record gives src/lib/scheduler.ts somewhere to report to.
- **Bulk endpoints for the collection grid's bulk actions** (high value, medium). CollectionGrid.runAll() loops the selection and issues one HTTP request per card — refreshing 40 selected cards is 40 sequential round trips, each re-opening the pricing pipeline, with a progress string as the only feedback. Add POST /api/cards/bulk accepting `{ ids: number[], action: 'refresh' | 'plan' | 'location' | 'delete' | 'submission', value?: unknown }` that runs inside a single better-sqlite3 transaction for the write actions and reuses the refresh job above for pricing. runAll then becomes one call, and partial failures come back as a per-id list instead of only the first error message.
- **Identification spend tracking and a cap** (high value, medium). Every photo is an Opus call and nothing records the cost. With `response.usage` captured in src/lib/identify/claude.ts, store per-call `{ model, inputTokens, outputTokens, at }` in a new `identify_usage` table (src/lib/db.ts SCHEMA + a MIGRATIONS entry), show a rolling 30-day token count and estimated dollars in the Settings "Data sources" panel next to the Claude row, and add an optional `IDENTIFY_DAILY_LIMIT` that makes /api/identify return 429 with a plain message once exceeded. Scan mode, which fires unattended two at a time, is the case this protects.
- **Keep the extra photos a card already has** (high value, medium). AddCardFlow lets you attach up to four photos (front, back, slab label) and sends them all to /api/identify, but `save()` persists only `imagePath: item.uploads[0]` — the back and label images are written to disk and then orphaned forever. Add an `image_paths TEXT NOT NULL DEFAULT '[]'` column via MIGRATIONS, store the full list, render a thumbnail strip on CardDetail that swaps the hero image, include them in buildBackup/restoreBackup (already name-validated by `isValidUploadName`), and delete them alongside the card in DELETE /api/cards/[id]. Back photos are exactly what you want when checking a grading outlook months later.
- **Snapshot retention and a daily portfolio aggregate** (high value, medium). The portfolio page calls `allSnapshots()`, which reads and JSON-parses every price_snapshots row ever written — with the default hourly scheduler that is one row per card per day, each holding a full PriceSummary including the whole `quotes` array. Add a `portfolio_daily(day, value, ungraded, priced)` table written at the end of each refresh pass, have src/app/page.tsx read that for the 1M/3M/1Y/ALL ranges and only touch raw snapshots for the recent window, and add a retention pass that thins snapshots older than ~90 days to one per day per card. Keeps the home page O(days) instead of O(cards × days) and shrinks the backup archive.
- **Wantlist driven by the set checklists** (high value, medium). /sets/[game]/[name] already computes exactly which numbered cards are missing from a set, but the list is inert — you cannot mark one as wanted, price it, or take it shopping. Add a `wantlist` table (game, setName, number, name, targetPrice), an "Add to wantlist" button on each missing row, a /wantlist page that prices the wanted cards through the existing `fetchQuotes`/`summarize` pipeline (no card row needed — /api/prices/lookup already prices unsaved cards), and a "cost to complete this set" total on the set page. It turns set completion from a report into the thing you actually use at a card show.
- **Reclaim orphaned uploads** (medium value, small). POST /api/uploads writes a file before any card references it, so every abandoned add-flow item, every failed scan and every removed duplicate leaves a ~1 MB JPEG in DATA_DIR/uploads forever; nothing ever sweeps them. Add `orphanedUploads()` to src/lib/images.ts (readdir minus the set of paths referenced by cards, guarded by a minimum age so an in-flight add is never eaten), surface the count and total bytes in the Settings backup panel next to the existing `backupSummary()` figures, and give it a "Reclaim N MB" button behind a confirm. Backups shrink by the same amount.
- **Buy-target alerts** (medium value, small). src/lib/alerts.ts raises three kinds — ready_to_grade, price_move, graded_data — all reactive. Add a `target_price` column on cards and a fourth kind, `target_hit`, in `alertsForRefresh` that fires when `next.ungraded` falls to or below the target (and for wantlist entries once that exists). The plumbing is all there: the alert list, the unread badge, the webhook delivery and the settings page need only the new kind added to KIND_LABEL/KIND_STYLE. This is the feature that makes the daily auto-refresh worth leaving on.
- **Printable submission packing slip** (medium value, small). The grading flow stops at "Mark as sent": there is no artifact to put in the box. Add a print view at /submissions/[id]/slip reusing the print stylesheet already in globals.css — batch name, company and service level, a numbered row per card with name, set, number, year, declared value (the captured `rawValue`) and a blank cert column, and a total declared value, which is what grading forms ask for. SubmissionDetail gets a "Print packing slip" button next to "Mark as sent", mirroring PrintButton on /report.
- **Sort and paginate the collection** (medium value, medium). src/app/collection/page.tsx renders every matching card in one grid, always ordered `updated_at DESC` (the ORDER BY is hardcoded in `listCards`), and computes the four header stats by iterating the whole result. There is no way to see the most valuable cards, the oldest, or the unpriced ones. Add a `sort` search param (value, name, year, added, updated) mapped to a whitelist of ORDER BY clauses in `ListOptions`, a `limit`/`offset` with a "Load more", and move the totals to a single SQL aggregate so the header does not depend on loading every row.
- **Manual sales comps per card** (medium value, medium). Graded prices come from PriceCharting or nothing, and everything else falls back to `ungraded × multiplier` from Settings — which the Settings copy itself admits is a rough guess that varies 2x to 10x by card. Sports cards have no free source at all. Add a `comps` table (cardId, grade or null, price, soldAt, venue, url, notes) and a small "Recent sales I've seen" panel on CardDetail; feed the median of recent comps for a grade into `summarize()` between the manual override and the provider quotes, and mark the resulting figure as "from your comps" in `yourCopyBasis`. It gives the grading outlook real data on exactly the cards where the estimate is weakest.
- **Explicit theme toggle** (low value, small). globals.css defines the whole dark palette under `@media (prefers-color-scheme: dark)` only, and the slab styles already reference `[data-theme="dark"]` / `:root:not([data-theme="light"])` selectors that nothing ever sets — the mechanism is half-built. Finish it: a small toggle in the layout nav writing `data-theme` on `<html>` and persisting to localStorage, an inline script in layout.tsx to apply it before paint, and the same `:root[data-theme=...]` guards applied to the background/foreground and chart variables so both directions win over the media query.

## Code quality

- **portfolioSeries recomputes the whole collection total at every snapshot** (high value, small, `src/lib/analytics.ts`). The loop over sorted snapshots iterates the entire `current` map on every iteration to re-sum value, ungraded and priced — O(snapshots × cards). With the default daily refresh that is 500 cards × 365 days = ~91M inner operations per home-page render, and it grows quadratically with time. Keep running totals instead: on each snapshot subtract the card's previous contribution and add the new one, tracking `priced` as a delta on the `>0` transition. Same output, O(snapshots). Add a test asserting the running-total version matches the current one on a fixture of 200 interleaved snapshots.
- **The portfolio page reads and parses every snapshot ever taken** (high value, medium, `src/lib/cards.ts`). `allSnapshots()` does `SELECT * FROM price_snapshots ORDER BY fetched_at` and `JSON.parse`s the full summary of every row, including the `quotes` array with every provider's matched name, URL and variant prices — of which the portfolio uses only `yourCopyValue` and `ungraded`. src/app/page.tsx then calls it on every render and builds a per-card Map from it as well. Two cheap wins before the aggregate table: select only what is needed (either `json_extract(summary, '$.yourCopyValue')` in SQL or stop storing `quotes` in the snapshot and keep them on the card row), and stop storing the same summary twice per refresh path.
- **Snapshot JSON is parsed unguarded while card JSON is not** (high value, small, `src/lib/cards.ts`). `rowToCard` routes every JSON column through the `parseJson` helper that swallows a parse error and falls back. `listSnapshots`, `allSnapshots` and `latestSnapshotsByCard` all call bare `JSON.parse(r.summary)`, as do `getChecklist`/`checklistForName` in src/lib/sets/index.ts on the `cards` column. One truncated row — from a half-written restore or a disk error — takes down the portfolio, the collection grid and the card page with an unhandled exception, because there are no error boundaries either. Route them through the same `parseJson` (skipping unreadable rows) and add a test that inserts a snapshot row with `summary = '{'` and asserts the portfolio still renders.
- **Multi-statement writes are not transactional, unlike intakeCard** (high value, small, `src/lib/sales.ts`). `recordSale` inserts the sale then calls `updateCard` to decrement quantity; `deleteSale` increments quantity then deletes the row (so a failed delete leaves copies restored and the sale still listed). `markSent` and `recordReturn` in src/lib/submissions.ts loop `updateCard` across every card in the batch outside any transaction, and `recordReturn` then does a separate status UPDATE. `intakeCard` shows the right pattern with `getDb().transaction(...)`. Wrap each of these the same way. Add tests: a sale whose card update throws must leave both quantity and the sales list unchanged, and a `recordReturn` that fails on the third card must not have graded the first two.
- **Named missing tests for logic that currently has none** (high value, medium, `tests/`). The suites cover pricing, analytics, repository, sales, submissions, alerts, import and zip well; these modules have nothing. src/lib/images.ts: `isValidUploadName` accepts only the 36-char-UUID form and rejects traversal, absolute paths and other extensions; `dominantColor` returns a #rrggbb for a solid JPEG and null for a non-image buffer. src/lib/settings.ts: `saveSettings` blanks a `javascript:`, `file:` or malformed `alertWebhookUrl` and clamps negatives to the defaults (the webhook is POSTed to by the server, so this is the SSRF boundary). src/app/api/export/route.ts: `cell()` prefixes a leading `=`, `+`, `-`, `@` or tab so a card name of `=cmd|'/c calc'!A1` cannot execute in Excel — the guard exists and is untested. src/lib/pricing/refresh.ts: `refreshAll({ staleHours })` skips a card refreshed inside the window, retries one whose last attempt produced no price only after the window, and does not double-count `skipped`. src/lib/cards.ts `normalizeInput`: a bogus `imagePath` becomes null, a non-#rrggbb `accentColor` becomes null, a non-http `referenceImageUrl` becomes null, and `location` is truncated to 120 characters.
- **conditionFromGrade is duplicated verbatim in two components** (medium value, trivial, `src/components/ScanFlow.tsx`). The same nine-line 10-point-grade-to-condition mapping exists at src/components/AddCardFlow.tsx:30 and src/components/ScanFlow.tsx:54, character for character. It is domain logic (it decides the condition a scanned card is saved with, which drives its valuation through `conditionMultipliers`) sitting in two client components with no test. Move it to src/lib/types.ts or a new src/lib/grading.ts, import it in both, and test the boundaries — 8 and 7.9, 6 and 5.9, 0, null, "PSA 10", garbage.
- **The card "detail" line is rebuilt in six places** (medium value, trivial, `src/app/page.tsx`). `[setName, '#' + number, year].filter(Boolean).join(' · ') || '—'` appears at src/app/page.tsx:29, src/app/submissions/[id]/page.tsx:24, src/lib/submissions.ts:54, src/components/CardTile.tsx:35, src/app/report/page.tsx:96 (with `variant` appended) and src/components/AddCardFlow.tsx:443 (with grade instead of year). Three of them are server-side, and the snake_case one in submissions.ts is a separate copy again. Add `cardDetail(card, opts?)` to src/lib/format.ts alongside `money`/`when`/`imageSrc` and call it everywhere, keeping the report's variant and the add-flow's grade as options.
- **Four private copies of the same Stat/Field tile** (medium value, small, `src/components/Portfolio.tsx`). `Stat` is defined at the bottom of Portfolio.tsx (label/value/tone), SubmissionDetail.tsx (label/value/sub/tone) and collection/page.tsx (label/value/sub); `Summary` in report/page.tsx and `Field` in CardDetail.tsx are the same tile again with different class strings. They already share `hero-figure`, `delta-up`/`delta-down` and the uppercase-tracking label style. Extract one `<Stat label value sub? tone? size?>` into src/components/Stat.tsx (server-safe, no hooks) and delete the five local copies.
- **Three components are large enough to hide their own logic** (medium value, medium, `src/components/CardDetail.tsx`). CardDetail.tsx is 545 lines holding eleven pieces of useState, five async handlers, the grading-outlook section, the sales ledger with its own form, the price-history table and two local components. AddCardFlow.tsx (493) nests a 200-line `ItemCard` under the queue logic, and Portfolio.tsx (418) mixes the hero, the range picker, the opportunity filter, the allocation bar, recent sales and top holdings. Split each along the seams already visible in the JSX — CardDetail into CardHeader / GradingOutlook / SalesLedger / PriceHistory; AddCardFlow's ItemCard into its own file; Portfolio's allocation, recent-sales and holdings sections into three presentational components. Nothing needs new state, only props that already exist.
- **Redundant queries in the refresh path** (medium value, trivial, `src/lib/pricing/refresh.ts`). `refreshAll` calls `listCards()` twice — once to build the queue and once purely to compute `skipped` as `listCards().length - queue.length` — reading and parsing every card row a second time. `refreshCard` fetches `listSnapshots(card.id, 200)` and then calls `latestSnapshot(card.id)` (another SELECT) even though `history[0]` is that exact row. The queue's worker pool also re-reads each card with `getCard(card.id)` after it was already loaded. Take the count from the first `listCards()`, use `history[0]` for the failure check, and keep the `getCard` re-read only if the staleness of the in-memory copy actually matters (it does not for `priceCard`, which only reads identity fields).
- **The grading verdict's thresholds are unnamed magic numbers** (medium value, trivial, `src/lib/analytics.ts`). `gradingVerdict` decides "prime" on `ratio >= 0.9`, prints "the widest" vs "close to the widest" on `ratio >= 0.999`, needs `series.length < 3` for "not enough history", and computes trend against `series[series.length - 4]` — four unexplained constants in the function the whole product is built around, and the README documents only one of them ("within 10%"). Hoist them to named consts with a sentence each. In the same file, `fmt()` is a third money formatter that differs from `money()` in src/lib/format.ts only by `maximumFractionDigits: 0` — give `money()` an options argument and delete it.
- **isClaudeConfigured ignores the credential sources the SDK actually accepts** (medium value, small, `src/lib/identify/claude.ts`). `isClaudeConfigured()` returns true only for ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, and its own doc comment notes the SDK also resolves an `ant auth login` profile. That boolean is threaded into AddCardFlow and ScanFlow as `claudeConfigured`, which skip the identify call entirely and tell the user to type the card in by hand — so someone authenticated by profile gets a wrong "ANTHROPIC_API_KEY is not set" banner and no identification at all. Either check for a resolvable credential (profile included) or invert the flow: always attempt, and let the existing 401 IdentifyError, which already has the right message, drive the banner.
- **Charts have no text equivalent and no announced readout** (medium value, small, `src/components/charts/PortfolioChart.tsx`). Both charts expose `role="img"` with a fixed aria-label ("Collection value over time"), are keyboard-focusable and move a crosshair with arrow keys — but the value the crosshair lands on is rendered into a `pointer-events-none` positioned div that no assistive technology will announce, and there is no tabular alternative to the data. CardDetail happens to have a price-history table; the portfolio and outlook charts have nothing. Add an `aria-live="polite"` visually-hidden region carrying the active point's date and values, put the current total and range into the aria-label, and add a collapsible `<table>` twin beneath each chart (the same convention the sibling randostats repo records as a hard rule).
- **Collection search does not escape LIKE wildcards** (low value, trivial, `src/lib/cards.ts`). `listCards` builds `params.q = '%' + search.trim() + '%'` for a LIKE against six columns. A search term containing `%` or `_` is interpreted as a wildcard, so searching for a card noted as "50% off" or "US_175" silently matches far more than intended. Escape the term (`replace(/[\\%_]/g, '\\$&')`) and add `ESCAPE '\'` to the clause. One-line fix; add it to the existing "filters and searches" case in tests/cards.test.ts.

## Shared across all Platteration repositories

The same gaps recur in every repository; fixing them once as a template and copying it is cheaper than fixing them fourteen times.

### CI and supply chain

1. **No workflow sets `permissions:`** (except the two Pages deploy jobs). Add `permissions: { contents: read }` at the top of every workflow so the `GITHUB_TOKEN` handed to third-party actions cannot write to the repository.
2. **No action is pinned to a commit SHA** (0 of 50 `uses:` lines across the fourteen repositories). `actions/checkout@v4` follows a movable tag; pin to the full 40-character SHA with the version in a comment, and let Dependabot bump it.
3. **No repository has Dependabot or Renovate.** Add `.github/dependabot.yml` with `npm` (or `pip`) and `github-actions` ecosystems, weekly.
4. **No CI step runs `npm audit`** (two workflows pass `--no-audit` explicitly). Add `npm audit --audit-level=high` after `npm ci`; for the Expo apps the current transitive advisories are build-time only (`uuid` via `xcode` via `@expo/config-plugins`), so gate on `high` rather than `moderate` until Expo ships the fix.
5. **`tvsham` runs `npm ci || npm install` in CI and in its Dockerfile.** The fallback silently discards the lockfile guarantee; drop it and fix the lockfile instead.
6. **`selfreportle`, `simplacad` and `phonogeometry` have no lockfile** and install Playwright ad hoc in CI. Add a `package-lock.json` (even with devDependencies only) and use `npm ci`.
7. **Enable secret scanning and push protection** in each repository's settings; nothing is committed today, and this keeps it that way.

### Repository hygiene

8. **Ten repositories have no `LICENSE`** (battleshiple, collectcollect, drawdraw, multidcheckers, multidconnect4, notenote, randostats, selfreportle, simplacad, tvsham). Without one, nobody else may legally use or contribute to the code. The siblings that have one use MIT.
9. **Only `simplacad` has a `SECURITY.md`.** Copy it to the others with a private reporting address.
10. **No repository has a `main` branch.** In all fourteen the default branch is the original `claude/...` feature branch, so branch protection, Dependabot targets and the two GitHub Pages workflows (`abientnoiser`, `chesscheatser` both trigger on `main`/`master`) all point at a branch that does not exist; those deploys have never run. Create `main` from the current branch, make it the default, and protect it.
11. **`drawdraw` is the one repository still on Expo SDK 53** (the rest are on 57). Its eight high-severity `npm audit` findings (`image-size`, `metro`) disappear with the SDK upgrade; it is also the only app not written in TypeScript and the only one pinned to Node 20 in CI.
12. **`multidcheckers` and `multidconnect4` are near-identical copies** (same branch name, same 65-file layout, same dependencies). The timeline/multiverse engine, persistence and share code should live in one shared package so fixes land in both.

### A hardened workflow to copy

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<full-sha> # v4
      - uses: actions/setup-node@<full-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```
