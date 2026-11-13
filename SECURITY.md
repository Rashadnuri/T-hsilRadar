# TəhsilRadar — Security Requirements

Status: Draft v0.1. These are requirements for design and review; they are not a certification claim.

## 1. Security goals

1. Users must trust that listed opportunities are real, sourced and current (**content integrity**).
2. User profile and application data is private (**confidentiality**).
3. Only authorized staff can publish or change content (**authorization**).
4. AI features cannot be abused to leak data, spend money or mislead (**abuse resistance**).

## 2. Threat model (top risks for this product)

| # | Threat | Impact | Primary controls |
|---|--------|--------|------------------|
| T1 | Scam/fake opportunities published (fees, phishing) | Severe trust damage, user harm | Mandatory official source + verification checklist, moderation queue, no auto-publish from imports, "report" button, link health checks |
| T2 | Broken access control (user reads another's applications; user becomes admin) | Privacy breach | RLS deny-by-default, roles in DB only, RLS tests in CI |
| T3 | Leaked `service_role` or LLM API key | Full data access / cost abuse | Server-only modules, secret scanning, no `NEXT_PUBLIC_` for secrets, rotation plan |
| T4 | Prompt injection via imported/submitted text | Misleading AI output, data exfiltration attempts | LLM has no tools, delimited untrusted data, output validation, no profile data in opportunity-only prompts |
| T5 | LLM cost abuse / DoS | Financial loss | Quotas, auth for expensive endpoints, global spend cap + kill switch |
| T6 | XSS via opportunity text, submissions or AI output | Account takeover | Escape by default (React), restricted markdown with sanitizer, CSP, never `dangerouslySetInnerHTML` with unsanitized content |
| T7 | Account takeover (credential stuffing) | Privacy breach | Supabase Auth rate limits, email verification, optional MFA for admins (required), breached-password check enabled |
| T8 | Open redirects / malicious outbound links | Phishing | `next` param allow-listed to same-origin paths; outbound links `rel="noopener noreferrer nofollow"` and https only |
| T9 | Spam submissions & reports | Moderator overload | Auth required to submit, rate limits, honeypot/Turnstile on anonymous forms, duplicate detection |
| T10 | Scraper/competitor abuse, DoS | Cost, availability | Vercel/Cloudflare protections, caching, rate limiting on search |
| T11 | Supply-chain compromise (npm) | Code execution | Lockfile, Dependabot, minimal deps, `npm audit` in CI, pinned GitHub Actions |
| T12 | Data loss / bad migration | Integrity | Backups, migrations in PRs, staging first |

## 3. Authentication

- Supabase Auth; no custom password handling.
- Email confirmation required before using account features. Password min length ≥ 10, leaked-password protection on.
- OAuth (Google) with verified-email requirement; link accounts by verified email only.
- **Admin and moderator accounts require MFA (TOTP)**; admin routes check the `aal2` assurance level.
- Sessions via httpOnly, Secure, SameSite=Lax cookies (`@supabase/ssr`). Server decisions use `supabase.auth.getUser()`.
- Auth emails sent from a custom SMTP sender with SPF/DKIM/DMARC configured.
- Password-reset and magic-link redirect URLs are restricted to our domains in Supabase config.

## 4. Authorization

- **Roles:** `user`, `moderator`, `admin` in `profiles.role`. Never read from `user_metadata` (user-editable).
- Role changes only via an admin-only `SECURITY DEFINER` function; every change is audit-logged. Direct updates to `profiles.role` are blocked with a trigger and column privileges.
- **RLS on every table**, deny by default; policies listed in DATA_MODEL.md §8. A CI test lists all `public` tables and fails if any lacks RLS or has no policy review.
- `SECURITY DEFINER` functions: set `search_path = ''`, schema-qualify objects, revoke from `public`, grant explicitly.
- Views exposed to anon use `security_invoker = true` (or are limited to safe columns).
- Server Actions and route handlers always re-check identity and role; UI hiding is not a control.
- Principle of least privilege for the Postgres roles and for the service role: only cron/import/AI-cache code paths may import `lib/supabase/admin.ts`.

## 5. Content integrity (verification workflow)

State machine:

```
draft ─► pending_review ─► published ─► archived
              │               │
              └─► rejected    └─► (re-verify) ─► published
```

Publishing requires (enforced by DB constraints + admin UI):
1. `primary_source_url` over HTTPS on the organization's official domain (admin confirms domain ownership; org website stored in `organizations.website_url`).
2. Verification checklist completed: official source; organization identity; deadline matches source; no payment-to-apply or scam indicators; links work.
3. `verified_by`, `last_verified_at`, and a `verification_records` entry.
4. At least one human-approved/original language version.

Ongoing:
- Four-eyes principle recommended for new organizations (a second moderator approves the org).
- Weekly link health check; failures put the item in a "needs recheck" queue and mark it publicly as "source temporarily unavailable" after N failures.
- Deadlines are re-verified when changed on the source (content hash change detection; L).
- Users can report an opportunity; reports are triaged in the admin dashboard.
- Edits to a published opportunity's critical fields (deadline, URL, eligibility) trigger a re-verification requirement and are audit-logged with diffs.
- Public badge shows the verification date, so staleness is visible.

## 6. Input handling and output encoding

- Zod validation on every server boundary; reject unknown fields.
- URLs: parse with `URL`, allow only `https:` (and `mailto:` where explicitly needed); block private IP ranges and localhost for any server-side fetch (SSRF protection for link checks/import).
- Rich text: store as restricted Markdown; render through a sanitizing renderer with an allow-list (no raw HTML, no `javascript:` links). Images in content are not allowed in MVP.
- File uploads (logos, later documents): Supabase Storage with size/MIME limits, server-side re-validation, random object names, public bucket only for approved logos; private bucket for anything user-owned.
- SQL: only parameterized queries / `supabase-js`; no string-built SQL. RPC functions use typed args.
- CSV imports: size and row limits; formula-injection characters (`= + - @`) neutralized when exporting.

## 7. Transport and browser protections

- HTTPS only, HSTS (preload after validation), no mixed content.
- Security headers via `next.config`/middleware:
  - `Content-Security-Policy` (nonce-based scripts; `connect-src` limited to our origin, Supabase, and analytics host; `frame-ancestors 'none'`)
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal
- CSRF: Server Actions have origin checks built in; custom POST route handlers verify `Origin`/`Host` and use SameSite cookies. Cron endpoints use a secret and are not callable from browsers.
- CORS: no wildcard; the API is same-origin only.

## 8. Secrets management

| Secret | Where it lives | Exposure rule |
|--------|----------------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env (public by design) | Safe to expose only because RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env, **server only**, production/staging separate | Never prefixed `NEXT_PUBLIC_`; file marked `import 'server-only'` |
| `LLM_API_KEY` | Vercel env, server only | Same |
| `CRON_SECRET` | Vercel env | Verified on cron routes |
| SMTP credentials | Supabase dashboard / Vercel env | — |
| Turnstile secret | Vercel env | — |

Rules:
- `.env*` files are git-ignored; only `.env.example` (no values) is committed.
- GitHub secret scanning + push protection enabled; a pre-commit/CI secret scan (e.g. gitleaks).
- Separate keys per environment; rotate on suspicion and on staff changes; document the rotation steps.
- Never log keys, tokens, prompts containing personal data, or full request bodies.

## 9. AI-specific security & ethics

- All LLM calls are server-side and authenticated/quota-limited. See ARCHITECTURE.md §8.
- Profile data sent to the LLM requires explicit opt-in (`ai_personalization_consent`), is limited to needed fields, and excludes direct identifiers. Provider terms should be reviewed to confirm no training on API data.
- AI output is untrusted: validated, length-limited, rendered as text, never executed, never written to published content without human approval.
- Match score copy rules (enforced in i18n review): no "probability/chance of admission" wording in any language; always show the disclaimer. Add i18n lint for banned phrases.
- Hallucination controls: grounded context only; "not specified in source" fallback; facts like dates and amounts come exclusively from database fields rendered by our UI, not from model prose.
- Machine translations are labelled; numbers/dates/URLs diff-checked against the source before an admin can approve.

## 10. Privacy and compliance

- Data minimization: no full date of birth, no national ID, no phone numbers at MVP.
- Lawful basis and notices: privacy policy and terms in AZ/RU/EN before launch; cookie consent only if non-essential cookies/analytics require it (prefer cookieless analytics).
- Applicable law: Azerbaijan's Law on Personal Data; GDPR-style rights are adopted as a baseline because the service is open to international users. **Legal review needed** (see open questions).
- User rights: export and delete account from the profile page (MVP: delete; export L). Deletion cascades per DATA_MODEL.md §10.
- Data location: Supabase region selected deliberately (EU region recommended); documented in the privacy policy.
- Application notes and statuses are private to the user; admins cannot browse them. Support access is by explicit, audited, time-limited action.
- Analytics: aggregate, no cross-site tracking, no PII; outbound click counts stored as counters, not per-user trails (unless the user is tracking applications).

## 11. Abuse prevention and rate limits (initial values, tune later)

| Endpoint | Limit |
|----------|-------|
| Login/register/reset | Supabase defaults + IP throttling |
| Search | 60 req/min/IP (cached) |
| AI explain/assistant | 20/day/user (free), 3/day anonymous disabled (auth required) |
| Submission | 5/day/user |
| Report | 10/day/IP or user |

## 12. Logging, audit and incident response

- `audit_log` for all admin/moderator mutations (who, what, before/after).
- Application logs: structured, no PII, 30-day retention.
- Alerting: Sentry on error spikes; Supabase and Vercel notifications for auth anomalies.
- Incident runbook (to write before launch): revoke keys, rotate secrets, disable AI via kill switch, unpublish by flag, notify users when required.
- Backups verified by a periodic restore test to staging.

## 13. Secure development lifecycle

- TypeScript strict, ESLint (security-relevant rules), no `any` in boundaries.
- PR review required; migrations and RLS changes need a second reviewer.
- CI: typecheck, lint, unit tests, RLS tests, `npm audit`, secret scan, dependency review.
- Dependabot weekly; pin GitHub Actions by SHA.
- Pre-launch checklist: RLS review, penetration-style test of IDOR on every `[id]` route, CSP validation, headers scan, auth flow review, prompt-injection test set for AI endpoints, load test of search.

## 14. Security acceptance criteria for MVP launch

- [ ] RLS enabled and tested on 100% of public tables
- [ ] No secret in client bundle or git history (scan)
- [ ] Admin MFA enforced
- [ ] Publish constraints enforced at DB level
- [ ] AI quotas and kill switch working
- [ ] CSP and security headers active
- [ ] Privacy policy and terms published in 3 languages
- [ ] Backup and restore tested
- [ ] Reporting channel (security contact `/.well-known/security.txt`) live

## 15. Implemented controls (Supabase phase)

| Requirement | How it is enforced | Verified by |
|-------------|--------------------|-------------|
| Public users can only read published opportunities | RLS policy on `opportunities` using one visibility function (published AND verified-or-demo); organizations, translations and category links are visible only through visible opportunities | `supabase/tests/rls.test.ts` (visibility matrix for `anon` and `authenticated`) |
| Public users cannot create, update or delete | RLS enabled on every table; **no** write policies; no INSERT/UPDATE/DELETE/TRUNCATE privileges for `anon`/`authenticated`; future tables private by default | rls tests: every write statement on every table is denied; static migration checks |
| Unverified records must not appear as verified | non-demo unverified/rejected records cannot be published (CHECK) and are hidden by RLS even if the CHECK were bypassed; `verified` requires verifier + date; a demo record can never be `verified`; the app never invents a verified status (mappers copy the stored status) | schema + rls + repository tests |
| Unreviewed machine translations are never public | RLS excludes `machine_draft`; the search index and repositories never include them | rls, parity and repository tests |
| Staff identities are not exposed | column privileges hide `verified_by`, `created_by`, `translated_by`, `reviewed_by` from public roles | rls tests (`has_column_privilege`) |
| Service-role key never in the browser | not `NEXT_PUBLIC_`; read only in `lib/env.ts`; used only by `lib/supabase/admin.ts` (`server-only`, currently imported by nothing); no client component may import Supabase, repositories, services or env | `src/lib/supabase/security.test.ts` |
| `.env.local` never committed; no secrets in git | `.gitignore` (`.env`, `.env.*`, `!.env.example`); `.env.example` holds placeholders only; a scan fails on JWT-like or key-like strings | `security.test.ts` |
| No privilege escalation through functions | no `SECURITY DEFINER` function exists; search functions are `SECURITY INVOKER` with an explicit execute grant (revoked from PUBLIC) | rls + static tests |
| Injection | all SQL parameters are bound (`rpc` arguments, `.eq/.in`); no string-built SQL in the app; free text is validated (no raw HTML) in Zod **and** in the database | schema tests, validation tests |
| Misconfiguration fails loudly | half-configured Supabase throws; placeholders count as "not configured"; a failing database raises an error instead of falling back to demo data | `env.test.ts`, repository tests |

Operational notes: the **anon key is public by design** — its safety is entirely the RLS policies above; never grant a public role more than SELECT. Set `SHOW_DEMO_CONTENT=false` in production (demo rows are then excluded in every query) and do not load `seed.sql` into a production database. Rotate the service-role key if it is ever exposed.

Open items for later phases: moderator/admin RLS policies and MFA enforcement (authentication phase), `audit_log`, rate limiting of the public RPC functions at the edge, and an automated RLS test against the hosted staging project.

## 16. Implemented controls (authentication phase)

- **Sessions:** Supabase Auth with PKCE; session cookies are written by the server only (`@supabase/ssr`), forced `httpOnly`, `SameSite=Lax`, `Secure` in production, 14-day lifetime. There is no browser Supabase client, so no token is readable by JavaScript.
- **Authorization is server-side:** `src/lib/auth/session.ts` (DAL) verifies the user with `getUser()` (server-validated, never `getSession()`). The `proxy.ts` check is only an optimistic redirect. Server actions derive the owner from the verified session, never from form fields; RLS enforces it again in PostgreSQL.
- **CSRF:** all mutations are Server Actions (Origin-checked by Next.js); logout is a POST, never a link.
- **No account enumeration:** login errors are identical for unknown email and wrong password; forgot-password always shows the same message; duplicate sign-up returns a neutral error. Login attempts are rate limited by Supabase Auth (fake backend: 5 failures).
- **Open redirects:** `?next=` goes through `safeNextPath` (same-site relative paths only, locale stripped, auth pages refused).
- **Passwords:** 10–72 bytes, common weak passwords refused, never echoed back or logged; Supabase hashes them (bcrypt).
- **Privacy:** profile data is private (RLS, no public query), never logged (`ProfileRepositoryError` carries no data), pages are `noindex` and `Cache-Control: private, no-store`. The only readable cookie (`tr-auth=1`) is a UI hint without identity.
- **Fake auth backend** (`FAKE_AUTH=1`) is development/test only and is disabled when `NODE_ENV=production`.
- **Limits:** email confirmation and rate-limit settings live in the Supabase project (enable "Confirm email"); MFA and CAPTCHA are deferred to the hardening phase.

## 17. Implemented controls (personal plan)

- **Ownership everywhere:** every plan record has `user_id`; RLS lets only that user read or change it (`supabase/tests/plan.test.ts`, 28 checks incl. user A/B isolation, anon denial, column privileges, cascades). Server code derives the owner from the verified session; no server action or handler accepts a user id.
- **Notes are private:** stored only in `applications.notes`; never part of any public query, join, log line, error message, or the `/api/my-plan/state` payload (ids and statuses only). The API route is `force-dynamic`, `Cache-Control: private, no-store`, and answers 401 without a session. Notes are plain text, rendered escaped.
- **Mutations** are Server Actions (Origin-checked by Next.js) that re-verify the session and, for save/track, that the opportunity is public.
- **Browser cache hygiene:** the client-side saved/tracked cache is cleared on login, logout and password change, and ignored when the sign-in hint cookie is gone.
- **Abuse limits:** 500 rows per user per table, 5000-character notes, strict id/status validation.
- **Not done (by request):** no email/push notifications for deadlines.

## 18. Implemented controls (matching and AI)

- **API key:** `ANTHROPIC_API_KEY` is read only in `src/lib/ai/config.ts`/`llm.ts` (server). The browser receives `{ available: boolean }` at most; responses and errors never contain the key, the model name or provider messages (errors are mapped to coarse codes). `.env.example` has a commented placeholder.
- **Optional feature / kill switch:** no key or `AI_ENABLED=false` → AI endpoints answer 503 and the UI hides the assistant. Rule-based matching has no dependency on it.
- **Endpoint hardening:** same-origin check (route handlers are not Origin-checked by Next.js), signed-in user required, JSON only, 4 KB body cap, strict Zod validation of id/task/locale/question.
- **Rate limiting:** per user per minute (default 5) and per day (40), plus a global daily ceiling (2000) as a cost cap; denied requests are not counted; `429` + `Retry-After`. In-memory per instance — move to a shared store when running several instances.
- **Prompt injection:** fixed system prompt (no user text); untrusted data (opportunity text, profile free text, question) sanitised (control/bidi characters removed, `<`/`>` neutralised so delimiter tags cannot be closed, length-bounded) and passed inside tagged blocks declared as data; questions that look like injection are rejected before any model call; the model's output is sanitised (no HTML, links, e-mails) and checked for invented numbers and wrong language.
- **Data minimisation:** the model receives education, field, graduation year, residence country, preferred countries, skills, languages, interests and preferred types — never name, e-mail, university, user id or notes. Opportunity URLs are not sent.
- **No write path:** the AI module gets read functions only (public record by id, own profile), the Anthropic request has no `tools`, and the code never imports repositories' writers or the service-role client (checked by a test).
- **Answer integrity labels:** every answer is shown as AI-generated and non-official; warnings are surfaced to the visitor.

## 19. Implemented controls (admin dashboard)

- **Roles are data, granted out of band.** `user_roles` is readable only by its owner and writable by nobody through the API (no policy, no privilege): a regular user cannot grant themselves admin, and neither can an admin grant others. The operator grants it in SQL: `insert into public.user_roles (user_id, role) values ('<auth user uuid>', 'admin');` (service role / SQL editor). There is no user-editable role field anywhere (profiles have none).
- **Server-side authorization, three layers.** (1) `proxy.ts` redirects signed-out visitors (optimistic only). (2) Every admin **page** calls `requireAdmin()` — session verified with the auth server, role read from the database, fail-closed; a signed-in non-admin gets a **404** (the area does not confirm it exists; there is deliberately no admin layout that would frame that 404). (3) Every admin **Server Action** → handler starts with `authorize(ctx)` (checked by a test: it must be the first thing each handler awaits). Hiding buttons is cosmetic only.
- **RLS is the last line.** Admin writes run under the admin's OWN session (no service-role key anywhere in the admin area); a non-admin who bypassed the app would get RLS errors/zero rows and `42501 admin access required` from every admin function (tested as a regular user and as anon).
- **Publishing rules are enforced twice:** in the handler (friendly, localized reasons) and by database constraints (official source, verification with verifier + date, explicit deadline, original with short description). Publishing always passes through review (draft → pending review → published). A published opportunity cannot be un-verified, deleted, or have verified facts changed without unpublishing first; editing critical facts of an unpublished verified record withdraws the verification.
- **Translations:** admins can only create `human` or `machine_draft` rows; **approving** a machine draft is a separate explicit action; machine drafts are never readable by the public (RLS); the original-language text cannot be removed or re-labelled and editing it outdates the other translations.
- **Verifier integrity:** `verified_by` is stamped by the database function from `auth.uid()` and is unreadable through the API; a trigger refuses forged values. Every admin action is appended to `admin_audit_log` (no content stored).
- **Input:** all fields validated (codes → localized messages), https-only URLs without credentials, no raw HTML, size limits mirrored by DB constraints; ids validated before any query; repository errors carry no row data.
- **Not done:** MFA for admins, admin-action rate limiting, an UI for granting roles (by design), per-field edit history.

## 20. Implemented controls (sources, import, data quality)

- **Same access model as the admin area:** every new page calls `requireAdmin()`; every action/handler starts with `authorize()` (tests enforce the order); the CSV template endpoint answers 401/404 to anyone else; `opportunity_sources` and the new functions are admin-only under RLS; anon cannot execute them.
- **Imports cannot escalate:** the CSV has no status/verification/verifier/date columns; imported rows are always created through `admin_save_opportunity` (draft, unverified); the commit re-validates server-side; limits 1 MB / 200 rows / 25 k characters per cell; text files only (control characters rejected); written cells are guarded against spreadsheet formula injection.
- **Untrusted content stays data:** HTML in any text is rejected; URLs must be https without credentials and are validated offline — **the server never fetches a URL from an import or a source** (no SSRF surface, no scraping, no violation of third-party terms).
- **Provenance & audit:** `source_id`, `import_batch`, audit entries for source changes, expiry checks and every saved record.
- **Data integrity:** official source mandatory; placeholder, local and IP addresses refused; exact duplicates never imported; passed deadlines can never be published; expiry detection never deletes or unpublishes.

## 21. QA and security audit (see SECURITY_AUDIT.md)
Findings and fixes from the audit phase: the audit log is now immutable for every role (migration 13: privileges revoked + trigger),
HSTS and a **partial** Content-Security-Policy (`frame-ancestors`, `base-uri`, `object-src`, `form-action`) are sent on every path,
`lib/ai/config.ts` and `llm.ts` are `server-only`, and form errors are linked to their fields and focused for assistive technology.
The nonce-based `script-src` CSP described in §7 is **not** implemented yet, and rate limits are still per-instance memory;
both are tracked in KNOWN_LIMITATIONS.md. Static guards for headers and `server-only` live in `src/lib/supabase/security.test.ts`;
catalogue-driven authorization checks in `supabase/tests/authorization-audit.test.ts`; data invariants in `supabase/tests/data-audit.test.ts`.

## 22. Deployment preparation
`npm run preflight` (`src/lib/preflight.ts`) checks a production environment without printing values: https origin as site URL, hosted Supabase
(both values, https, anon key not a service key), no secret-looking `NEXT_PUBLIC_*` names, no demo content, no development switches. The unused
service-role key must not be set in Vercel. `SHOW_DEMO_CONTENT` is hidden by default in production builds that have Supabase configured; a demo-only build (no Supabase) shows the labelled built-in cards. Previews are never indexed
(`robots.txt` + `X-Robots-Tag`) and must use a separate staging Supabase project. CI (`.github/workflows/ci.yml`) runs with least-privilege permissions
and no secrets. See DEPLOYMENT.md.

`GET /api/health` is public and unauthenticated by design and returns only `ok` / `unavailable` (no hosts, versions, counts or error text; tested). Server errors are logged as one JSON line each (`src/instrumentation.ts` → `src/lib/observability.ts`) with secrets and e-mail addresses redacted, the query string removed from the path, and no headers, cookies, bodies or user ids. The public contact address (`NEXT_PUBLIC_CONTACT_EMAIL`) is validated (no placeholder, no characters that could inject into a link) and is public by nature.
