# TəhsilRadar — security audit

Audit of the implemented platform (phases 0–10) against [SECURITY.md](SECURITY.md). Method: code review of every
security-relevant path, catalogue-driven database tests, live HTTP probes, and hostile-input tests in a browser.
It is a white-box review by the developer's own tooling, **not** an independent penetration test (see
[Limits of this audit](#9-limits-of-this-audit)).

**Result.** No critical or high-severity vulnerability was found. One medium issue (audit log not tamper-resistant
against the server key) and two low issues were fixed. Three medium items remain open and are documented honestly in
sections 1, 7 and 10 — chiefly that rate limits live in one server's memory.

## 1. Findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| S-01 | Medium | **Fixed** | `admin_audit_log` was append-only for API users only; `service_role` held `ALL` on it, so a leaked/misused server key could rewrite history. Migration 13 revokes UPDATE/DELETE/TRUNCATE and adds a trigger that refuses them for every role |
| S-02 | Low | **Fixed** | No `Strict-Transport-Security`; nothing prevented `<base>` injection, plugin content, or forms posting off-site. Added HSTS (1 year, no `includeSubDomains`/preload) and a partial CSP |
| S-03 | Low | **Fixed** | `lib/ai/config.ts` (reads the API key) and `llm.ts` (SDK) were not marked `server-only`. The bundle was clean, but the guard is what keeps it clean. Added, and a test forbids client imports of secret-handling modules |
| S-04 | Medium | **Open** | Rate limits are in-memory, per server instance, and only cover AI and sign-in. On serverless hosting the effective limit is multiplied by the number of warm instances. See §7 |
| S-05 | Medium | **Open** | The CSP has no `script-src`/`connect-src` (needs a nonce strategy validated against Next's inline scripts). XSS defence therefore rests on escaping + input rejection, not on the browser |
| S-06 | Medium (operational) | **Fixed** (deployment-preparation phase) | `SHOW_DEMO_CONTENT` defaulted to *on*. Now an unset value is *hidden* in any production build, and `npm run preflight` rejects `true` in production. Verified on a production build (0 visible demo mentions, demo URLs 404) |
| S-07 | Low | **Open** | Dev-tooling advisories in `npm audit` (Vitest mocker, `minimatch` via ESLint). Production dependencies: **0 vulnerabilities** |

## 2. Secrets and environment variables

| Variable | Exposure | Check |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public by design | safe only because RLS lets `anon` read nothing but published, verified-or-demo rows (tested) |
| `NEXT_PUBLIC_SITE_URL` | public | canonical URLs only |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | read in one function (`lib/env.ts`); used by one module (`lib/supabase/admin.ts`, `server-only`); the app does not currently call it at all |
| `ANTHROPIC_API_KEY` | **server only** | `lib/ai/config.ts` (`server-only`) → `llm.ts` (`server-only`) → route handler |
| `FAKE_AUTH`, `AI_FAKE`, `FAKE_ADMIN_EMAILS` | dev only | the fake modules throw at load when `NODE_ENV=production`, and the mode switch ignores `FAKE_AUTH` there (unit-tested) |

Evidence:
- Pattern scan of the whole tree (Anthropic keys, JWTs, AWS keys, private keys, Supabase tokens): only obvious test fixtures match.
- Scan of the compiled **client bundle** (`.next/static`) for `SERVICE_ROLE`, `ANTHROPIC_API_KEY`, `sk-ant`, `FAKE_AUTH`, `AI_FAKE`, `service_role`: **no matches**.
- Canary test: production server started with `SUPABASE_SERVICE_ROLE_KEY=SERVICE-ROLE-CANARY-…` and an unreachable backend; 13 routes fetched and the server log read — the canary and the dummy anon key appear in **no** response and **no** log line, nor do submitted passwords or e-mails.
- `.env.example` holds placeholders only; `.gitignore` excludes `.env` and `.env.*` (except the example). The project is not a git repository, so history could not be scanned.

## 3. Injection

| Class | Result |
|---|---|
| SQL injection | The app builds no SQL. All access is through supabase-js (parameterised PostgREST filters and `rpc()` with typed arguments). In migrations the **only** dynamic SQL is one `EXECUTE format('… %I …', tg_table_name) USING new.user_id` in a trigger: identifier from trigger metadata (not user input), value bound as a parameter. Admin functions take validated JSON and typed parameters |
| Hostile identifiers | opportunity/user ids pass an allow-list regex before any query; a classic `x'; drop table …--` id is rejected with 400 |
| XSS — reflected | `q`, `type`, `city`, `page`, `scope`, `next`, `error` and path segments carrying `"><script>` / `<img onerror>` payloads: none appear unescaped in the HTML |
| XSS — stored | (1) Input: every free-text field of the opportunity, organisation, source, profile and registration forms, and every CSV cell (same parser), rejects raw HTML (`html_not_allowed`). (2) Output: there is **no** `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `document.write` anywhere in `src`; React escapes everything else. (3) Test: an organisation and an opportunity (all languages) were saved through the real admin UI with entity-encoded tags, quote-breaking attributes and template syntax; the admin lists and edit form rendered them as literal text; no script ran, no `<img>` was created, no dialog fired |
| Links | `href` values from data are `https://` only — enforced by the form parser, by the CSV parser, and by database `CHECK` constraints; all external links use `rel="noopener noreferrer nofollow"` |
| Open redirect | `safeNextPath` allow-list; 40+ attack strings in the unit suite (`//evil`, `\\evil`, `/%2F%2Fevil`, `javascript:`, CR/LF, tabs …) |
| CSV / formula injection | cells that start with `= + - @` are neutralised in the downloadable template; imports never execute or fetch anything |
| SSRF | the import workflow performs **no** network request to any user-supplied URL (validation is offline); enforced by a static test that bans `fetch` in `lib/import` |
| Prompt injection | see §6 |

Gap: stored-XSS output was exercised on admin pages. Public pages use the same React escaping, but a *published
database record containing hostile text* was not rendered end to end on the public pages (the sandbox's fake mode
serves public pages from demo data).

## 4. Authentication, sessions, CSRF

- Session cookies: `httpOnly`, `SameSite=Lax`, `Secure` in production, 14-day lifetime, `path=/`; the only readable cookie is a non-sensitive UI hint (`tr-auth=1`).
- Every protected page re-verifies the session on the server; the proxy's check is explicitly only an optimistic redirect.
- No account enumeration (probed live in this audit): a wrong password and an unknown e-mail return the identical message; registering an e-mail that already exists returns a neutral "couldn't complete your registration" message. Repeated failures lock the account ("Too many attempts…"), and a correct password is also refused while locked. This exercises the app's own gateway; real Supabase Auth applies its own, different thresholds, which were not tested.
- Responses of session pages carry `Cache-Control: private, no-store` (proxy + `next.config.ts`), and API responses add `Vary: Cookie`.
- CSRF: Server Actions are origin-checked by Next.js; JSON route handlers use an explicit same-origin check (cross-origin POST → 403, missing `Origin` → 403); `SameSite=Lax` adds a second layer.
- Backend down: sign-in returns a neutral localized "service temporarily unavailable"; nothing sensitive is logged.

## 5. Authorization, RLS and data isolation

Catalogue-driven tests (`supabase/tests/authorization-audit.test.ts`) walk the database rather than a hand-written list:

| Test | Result |
|---|---|
| Every `admin_*` function (19, including two internal helpers whose `EXECUTE` is revoked) refuses `anon` and a signed-in **non-admin**, and fails on the authorization/permission check *first* | ✅ |
| No function in `public` is `SECURITY DEFINER` | ✅ (0) |
| Every table in `public` has RLS enabled | ✅ |
| A non-admin cannot delete rows from any admin-managed table | ✅ |
| A user cannot insert/update a role, read another user's role, and `is_admin()` is false for them | ✅ |
| Audit log: UPDATE/DELETE/TRUNCATE refused for `service_role`, `authenticated`, `anon` **and the owner** | ✅ |

Admin surface (every route re-verified server-side; the proxy is not relied on):

| Route | Anonymous | Signed-in non-admin | Admin |
|---|---|---|---|
| `/{az,ru,en}/admin`, `…/opportunities`, `…/new`, `…/[id]/edit`, `…/organizations`, `…/sources`, `…/import`, `…/quality` | redirect to login (locale and `next` kept) | **404** (existence not revealed) | 200 |
| `GET /api/admin/import-template` | 401 | 404 | CSV |
| Server Actions behind these pages | each begins with an authorization check (static test: first awaited call) | refused | allowed |

User isolation: saved items, applications, notes, profile and matching are scoped to the verified session user by
RLS *and* by the handler. The browser suite switches users inside one browser and asserts that B never sees A's
state or notes; the state endpoint is 401 after logout. Notes never appear in the snapshot endpoint. Roles are
granted only by operator SQL — there is no API path to write `user_roles`.

## 6. AI API security

| Control | Evidence |
|---|---|
| Key never reaches the browser | server-only modules; bundle scan clean; browser sends an id, a task name, a locale and an optional ≤ 500-character question |
| Authentication required | anonymous → 401 |
| Same-origin only | no/foreign `Origin` → 403 |
| Strict request shape | unknown task, bad locale, bad id → 400; oversize body → 413; wrong content type → 415; unknown extra fields are dropped by the schema (a `systemPrompt` field is ignored) |
| Rate limits | per user: 5/minute and 40/day; global 2000/day; `Retry-After` on 429. Verified live: requests 1–5 → 200, 6–8 → 429 `Retry-After: 60`; a second user is unaffected |
| Prompt-injection controls | questions that try to override instructions are refused with a localized message and never sent; opportunity text is passed as data and labelled untrusted; answers are checked: numbers/dates not in the source are flagged, links are removed, wrong-language answers are flagged |
| Data minimisation | only the facts needed (derived profile attributes, no name/e-mail/notes) |
| AI cannot change data | the AI path has read-only loaders and no write dependency; answers are never stored as official fields |
| Kill switch / no key | `AI_ENABLED=false` or a missing key → panel says unavailable; the rule-based engine keeps working (85-check browser run with AI off) |

Not verified: behaviour against the real provider (timeouts, 429s from the provider, refusal text).

## 7. Rate limiting and abuse

| Surface | Limit | Notes |
|---|---|---|
| AI explanations | per user minute/day + global day | **in memory, per instance** |
| Sign-in / registration / reset | failed-attempt lock-out in the app gateway, plus Supabase Auth's own limits when real auth is configured | the fake gateway (dev) models the app-level part |
| CSV import | 1 MB, 200 rows, 25 000 chars per cell; admin-only | |
| JSON bodies | 4 KB | |
| Saved items / applications | 500 per user (database trigger) | not rate-limited per time |
| Profile saves, plan edits, admin actions, search, catalogue | **none** | all authenticated or public-read; abuse would show as load, not as data exposure |

Recommendation (S-04): move the AI and sign-in counters to a shared store (a Supabase table with an atomic
increment, or an edge KV) before real traffic; add a coarse per-IP limit at the host/CDN for search and public pages;
set a hard spend limit at the AI provider regardless.

## 8. HTTP headers

| Header | Before | After |
|---|---|---|
| `X-Content-Type-Options: nosniff` | ✅ | ✅ |
| `X-Frame-Options: DENY` | ✅ | ✅ |
| `Referrer-Policy: strict-origin-when-cross-origin` | ✅ | ✅ |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | ✅ | ✅ |
| `Strict-Transport-Security: max-age=31536000` | ❌ | ✅ |
| `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'` | ❌ | ✅ (partial) |
| `Cache-Control: private, no-store` on session pages and API | ✅ | ✅ |
| `X-Powered-By` | removed | removed |
| `robots` | private pages and demo records `noindex`; `robots.txt` allows all | unchanged |

Hosting platforms (e.g. Vercel) may add HSTS themselves; the app now sets it regardless. `includeSubDomains` and
`preload` were deliberately **not** set — they commit the whole domain and are the operator's call.

## 9. Limits of this audit
- Done by the developer's tooling, not an independent tester; no fuzzing, no dependency-confusion review, no review of the hosting configuration.
- Hosted Supabase (Auth e-mail flows, JWT validation, PostgREST) and the real AI provider were not available in the sandbox; the corresponding controls are verified up to the interface (PostgreSQL 16 with a Supabase-like role stub; a deterministic stand-in for the model).
- No load or denial-of-service testing.
- No review of backups, key rotation, incident response, or monitoring — none are set up yet.

## 10. Pre-launch security checklist (still to do)
1. Shared-store rate limits (S-04) and host-level limits.
2. Nonce-based `script-src` CSP validated in a staging build (S-05).
3. ~~Set `SHOW_DEMO_CONTENT=false` in production~~ — done by default since the deployment-preparation phase (set it explicitly anyway; preflight checks it).
4. Run the migrations on a real Supabase project; repeat `authorization-audit.test.ts` against it; confirm the `auth` schema assumptions.
5. Grant the first admin by SQL; confirm a second, ordinary account gets 404 on `/admin`.
6. Exercise sign-up, confirmation, reset and AI once with real keys; set a provider spend cap.
7. Add error monitoring (the error boundary currently only logs to the console) without logging personal data.
8. Independent penetration test before real opportunities and real users.
