# TəhsilRadar — known limitations

What the platform does **not** do, what was **not** verified, and what must happen before it carries real
opportunities and real users. Written to be read before a launch decision. Related:
[QA_REPORT.md](QA_REPORT.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Severity: **High** blocks a public launch · **Medium** should be done before real traffic · **Low** acceptable for a pilot.

## 1. Must-know before launch

| # | Sev. | Limitation | What to do |
|---|---|---|---|
| L-01 | **High** | **There is no real content.** Every opportunity is a fictional, labelled demo record; none is verified by a person, and all demo translations are placeholders. The platform's value (trusted, verified opportunities) does not exist yet | Import real records through the review workflow, each with an official source and a human verification; keep demo content hidden |
| L-02 | Medium | **Rate limits live in one server's memory** (AI and sign-in). On serverless hosting every warm instance has its own counters, so real limits are looser than configured and reset on cold start. Saved items, profile saves, plan edits, admin actions and search have no time-based limit | Shared counter store (e.g. a Supabase table with atomic increment), a CDN/host per-IP limit, and a provider-side spend cap on the AI key |
| L-03 | Medium | **The CSP is partial** (framing, `<base>`, plugins, form targets). It has no `script-src`/`connect-src`, so the browser would not stop an injected script. Current XSS defence = escape-by-default + HTML rejected on input + no raw-HTML sinks | Nonce-based CSP validated in staging with Next's inline scripts and the Supabase origin |
| L-04 | ~~Medium~~ **Resolved** | `SHOW_DEMO_CONTENT` used to default to on. Since the deployment-preparation phase an unset value is hidden in any production build, and the preflight rejects `true` in production. **Vercel Preview** deployments are production builds too: set `SHOW_DEMO_CONTENT=true` for the Preview scope if you want to demo the interface there | Set it explicitly anyway (`DEPLOYMENT.md` §6) |
| L-09 | **High** | **No legal pages, and the contact channel needs your address.** There is no privacy policy or terms page (the registration form says they "will be published before registration goes live"); the site stores accounts and private profile data. The Contact page now supports a real address via `NEXT_PUBLIC_CONTACT_EMAIL` (e-mail card with prefilled subjects), but until you set it the page still says its form is not active and there is no way to reach you. There is no contact *form* handler | Owner: set the mailbox, and get reviewed privacy/terms texts (`DEPLOYMENT.md` §1) |
| L-05 | Medium | **Hosted Supabase was never run.** Migrations, RLS, functions and the audit tests ran on PostgreSQL 16 with a stand-in for Supabase's `auth` schema and roles. Supabase Auth e-mails (confirmation, reset), JWT handling and the PostgREST HTTP layer were not exercised, and the app's login lock-out was tested only against its own gateway model | Apply the 13 migrations to a staging project; rerun `authorization-audit.test.ts`; sign up, confirm, reset, and sign in once by hand |
| L-06 | Medium | **The real AI provider was never called.** The AI path was tested with a deterministic stand-in; provider errors, timeouts and 429s are unit-tested only | Exercise once with a real key and a low spend cap; check refusal and long-answer handling |
| L-07 | Medium | **Monitoring is only a baseline.** Added: `GET /api/health` (200/503) for uptime monitors, and structured `request_error` log lines without personal data. Still missing: an actual uptime monitor and alert routing (yours to create), an error tracker, backup/restore test and a key-rotation procedure | Create the monitor and alerts; decide on an error tracker; test a restore |
| L-08 | Medium | **No independent security review.** The audit was done with the developer's own tooling | Independent penetration test before real users |

## 2. Product and content

| # | Sev. | Limitation |
|---|---|---|
| L-10 | Low | **Import has no live checking.** Links are validated offline only (format, https, placeholder / shortener / social domains). Nothing fetches a page, so "the page still exists" is never taken as "the opportunity is open" — this is deliberate (terms of use, SSRF). "Mark as checked" is a human action. No official API / feed connectors exist yet |
| L-11 | Low | CSV import: original languages az / ru / en only; at most 200 rows, 1 MB and 25 000 characters per cell per file; no update-existing-record mode (duplicates are skipped, never overwritten) |
| L-12 | Low | **Expiry is not automatic.** Visitors always see a passed deadline as expired (derived at render time), but the stored status changes only when an admin runs the expiry check. Search/matching use the derived state |
| L-13 | Low | Verification freshness (90 days) is *reported* on the quality page, not enforced: a verified record that is never re-checked stays "verified on <date>" with that date visible |
| L-14 | Low | Machine translations are not produced by the platform; imported translations of unknown origin are stored as hidden drafts until a human reviews them. No translation-memory or glossary tooling |
| L-15 | Low | Roles are granted only by operator SQL; there is no UI for managing admins (by design). A single role (`admin`) exists — no editor/reviewer separation |
| L-16 | Low | No e-mail notifications or deadline reminders (explicitly out of scope so far). The plan page is the only place deadlines are tracked |
| L-17 | Low | Matching is rule-based on what the source *states*; "not stated" is shown as unknown, never as eligible. It is advice, not a decision, and it does not cover every eligibility nuance |
| L-18 | Low | Search is trigram similarity with accent folding (`pg_trgm` + `unaccent`) over az/ru/en text; no PostgreSQL full-text search, synonyms, or ranking by popularity |

## 3. Quality and compatibility

| # | Sev. | Limitation |
|---|---|---|
| L-20 | Low | **Accessibility is verified by automation + a keyboard script only.** axe (WCAG 2.0/2.1 A/AA) is clean on every page type in 3 languages, but no human screen-reader session, no forced-colours / high-contrast check and no 200–400 % zoom check were done (320 px reflow was) |
| L-21 | Low | Tested in Chromium only. No Safari, Firefox, real iOS/Android devices; "mobile" means viewport emulation |
| L-22 | Low | No performance, load or Core Web Vitals measurement. Opportunity detail pages are static with 10-minute revalidation; the catalogue list is rendered per request |
| L-23 | Low | When a server error happens while a page is streaming, the error screen is shown but the HTTP status stays **200** (Next.js has already sent headers). Crawlers and uptime monitors may not notice; error pages are not indexed content but check monitoring by body, not only by status |
| L-24 | Low | Azerbaijani date-times use the browser's CLDR pattern (`17 dekabr 2026/17:18 GMT+4`). Correct per the platform data, but visually unusual |
| L-25 | Low | **One unexplained test result:** a single catalogue check (city-chip text) failed once under `next dev` and never in the production build (77/77). Not reproduced; cause unknown |
| L-26 | Low | Public pages rendering a *database-sourced hostile record* end to end were not tested (the sandbox's fake mode serves public pages from demo data). The same escaping was verified on admin pages and no raw-HTML sink exists in the code |

## 4. Security hygiene

| # | Sev. | Limitation |
|---|---|---|
| L-30 | Low | `npm audit` reports moderate advisories in **dev tooling only** (Vitest's mocker, `minimatch` inside the ESLint chain). Production dependencies: 0. The fixes are breaking major upgrades of the toolchain |
| L-31 | Low | The audit log records who/what/which record (no content, by design). The database owner / a superuser can still drop the protecting trigger — that is an operator action, not an API path |
| L-32 | Low | `robots.txt` allows everything; private and demo pages rely on `noindex` meta tags (verified), not on `Disallow` |
| L-33 | Low | HSTS is set without `includeSubDomains`/`preload`; adopting those is a per-domain operator decision |
| L-34 | Low | The project is not a git repository, so secret scanning of history was impossible; only the current tree was scanned |

## 5. Environment notes for whoever picks this up
- Database tests need a PostgreSQL 16 superuser in `TEST_DATABASE_URL` (the suites create and drop throw-away databases); without it they are skipped.
- The browser suites used a development-only fake authentication / fake admin store (`FAKE_AUTH=1`, `FAKE_ADMIN_EMAILS`) and an AI stand-in (`AI_FAKE=1`). These refuse to load in production builds.
- Project instructions (`AGENTS.md`) warn that this Next.js version differs from older ones (e.g. `proxy.ts`, async `cookies()`/`params`); the code follows the installed version's docs.

## 6. Added in the deployment-preparation phase
| # | Sev. | Limitation |
|---|---|---|
| L-40 | Medium | **Nothing has been deployed or verified on GitHub, Vercel or a hosted Supabase project.** `ci.yml` has never run on GitHub; `supabase/config.toml` could not be validated (the Supabase and Vercel CLIs are not installed in the build environment); the localized e-mail-template mechanism (`{{ .Data.locale }}`) is documented but unexercised |
| L-41 | Low | **The browser audits are not in the repository.** The Playwright, axe-core and Lighthouse runs behind `QA_REPORT.md` used throw-away scripts; only the commands in the README can be re-run from the repo. Consider porting the scripts into an `e2e/` folder |
| L-42 | Low | **Performance was measured only locally**, on a production build without a CDN, with Lighthouse's simulated slow-4G / 4× CPU profile: performance 88–95, LCP 2.9–3.5 s (text element, mostly main-thread render delay), CLS 0. Real-world numbers on Vercel are unknown. An attempt to speed up fonts by splitting Inter into two instances made things *worse* (duplicate downloads) and was reverted |
| L-43 | Low | **SEO scope.** Filtered and search catalogue views canonicalise to the plain catalogue, so, for example, "Azerbaijan internships" is not its own indexable landing page; dedicated landing pages would need their own titles and content. Opportunity pages carry no structured data beyond the shared `WebSite` block on the home page. The sitemap lists at most 1000 active opportunities (×3 languages) and is rebuilt hourly |
| L-44 | Low | The three share/icon images are generated, language-neutral brand assets (`public/og.png`, `src/app/icon.svg`, `apple-icon.png`, `favicon.ico`); replace them if you have official branding |
| L-45 | Low | `supabase/config.toml` pins `major_version = 15` for the **local** stack; hosted projects choose their own Postgres version (the migrations were tested on 16) |
