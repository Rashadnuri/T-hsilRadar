# TəhsilRadar

**A multilingual (Azerbaijani · Russian · English) platform that helps students and young professionals in
Azerbaijan find verified education and career opportunities — in Azerbaijan and abroad — each with a link to its
official source.**

> **Status: pre-launch.** The application is feature-complete for a pilot, but it contains **no real opportunities
> yet**: every record shipped with the code is fictional demo content, clearly labelled and never indexed. Nothing in
> this repository has been deployed by its authors. Read [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) and
> [`DEPLOYMENT.md`](DEPLOYMENT.md) before putting it online.

## Contents
[Features](#features) · [Technology](#technology-stack) · [Languages](#supported-languages) ·
[Local development](#local-development) · [Environment variables](#environment-variables) ·
[Supabase setup](#supabase-setup) · [Migrations](#database-migrations) · [AI configuration](#ai-api-configuration) ·
[Admin and import](#administration-and-data-import) · [Testing](#testing) · [Deployment](#deployment) ·
[SEO](#seo-and-localized-routing) · [Known limitations](#known-limitations) · [Documentation map](#documentation-map)

## Features

| Area | What it does |
|---|---|
| **Discovery** | Catalogue of scholarships, internships, admissions, exchanges, courses, competitions, grants and more. Separate **Azerbaijan** and **International** views, Azerbaijani city shortcuts, search (accent-insensitive, all languages) and filters (type, level, field, country, funding, format, deadline, verification) |
| **Trust** | Every public record needs an **official source** link and a human **verification** (who, when). Deadlines are evaluated at render time, so an expired opportunity is never shown as open. Demo records are labelled and never indexed |
| **Multilingual content** | Each opportunity keeps one *original-language* text plus translations (human, machine draft, outdated). Pages show the best available language with an explicit notice; official facts (dates, amounts, links) are language-neutral and never translated |
| **Accounts** | Sign-up, e-mail confirmation, login, password reset (Supabase Auth), private profile |
| **Personal plan** | Save opportunities, track applications (Interested → Accepted/Rejected/Withdrawn), private notes, deadlines — visible only to the owner (row level security) |
| **Matching** | Transparent rule-based match of a profile against an opportunity (reasons, missing and unknown criteria). Optional **AI explanations** that can never change data |
| **Admin** | Role-protected dashboard: create/edit opportunities, translation coverage, review → verify → publish workflow, organizations, **sources**, **CSV import** (preview, duplicate detection, always imported as unverified drafts), **data-quality report**, append-only audit log |
| **Security** | Row level security everywhere, no `SECURITY DEFINER`, server-side authorization on every admin route and action, hardened session cookies, security headers, input validation, rate-limited AI endpoint |

## Technology stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts`), **React 19**, **TypeScript** (strict)
- **Tailwind CSS 4**, Radix `Slot`, lucide icons, Inter font (Latin, Latin-Extended, Cyrillic)
- **next-intl 4** for routing and messages (typed, key parity enforced by `npm run i18n:check`)
- **Supabase**: PostgreSQL 15+ (migrations, RLS, SQL functions), Supabase Auth via `@supabase/ssr`
- **Zod 4** validation; **Anthropic SDK** (optional AI explanations, server-side only)
- **Vitest** (unit + real-PostgreSQL database suites), Playwright used for browser checks
- **Vercel** (hosting) · **GitHub Actions** (CI)

> `AGENTS.md` warns that this Next.js version has breaking changes compared with older releases
> (e.g. `proxy.ts` instead of `middleware.ts`, async `cookies()` / `params`). The code follows the installed
> version's documentation in `node_modules/next/dist/docs/`.

## Supported languages

| Code | Language | Role |
|---|---|---|
| `az` | Azərbaycanca | default language |
| `ru` | Русский | full UI + content |
| `en` | English | full UI + content |

Every URL carries its language (`/az/…`, `/ru/…`, `/en/…`). `/` redirects using the `NEXT_LOCALE` cookie, then the
browser's `Accept-Language`, then `az`. Opportunity *originals* may be in another language (e.g. German or Turkish);
the UI is never translated into more than these three. Details: [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md).

## Local development

Requirements: **Node.js 22** (`.nvmrc`), npm. Docker + Supabase CLI are only needed for the optional local database.

```bash
npm ci
cp .env.example .env.local      # optional: the defaults work
npm run dev                     # http://localhost:3000  → redirects to /az
```

Without any configuration the app runs on **labelled demo data** and shows "authentication is not configured" on the
account pages. Three ways to go further:

| You want | Do this |
|---|---|
| Try sign-up, profile, plan, matching, admin **without** Supabase | `FAKE_AUTH=1 FAKE_ADMIN_EMAILS=you@example.com npm run dev` — an in-memory stand-in (development only; refuses to load in production; data is lost on restart) |
| Try the AI panel without a key | add `AI_FAKE=1` — a deterministic stand-in for the model |
| The real stack locally | `supabase start && supabase db reset`, then put the printed URL and anon key into `.env.local` |

Useful commands:

| Command | Purpose |
|---|---|
| `npm run check` | i18n parity + TypeScript + ESLint + all tests |
| `npm test` | Vitest. The **database suites** need a PostgreSQL superuser in `TEST_DATABASE_URL` and are **skipped** without it |
| `npm run build` / `npm start` | Production build / serve it (demo data is hidden in a production build unless `SHOW_DEMO_CONTENT=true`) |
| `npm run preflight -- <env file>` | Checks a production environment and prints problems **without printing any value** |
| `npm run db:seed:generate` | Regenerates the demo-only `supabase/seed.sql` |

## Environment variables

[`.env.example`](.env.example) documents **every** variable the code reads (a test enforces this). Summary:

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | production | Public origin (`https://tahsilradar.az`): canonical URLs, hreflang, sitemap, Open Graph, e-mail links. Set for **Production only**; unset on Vercel previews |
| `NEXT_PUBLIC_SUPABASE_URL` | public | production | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | production | **anon / publishable** key (safe in the browser *because of RLS*). Never the service-role key |
| `NEXT_PUBLIC_CONTACT_EMAIL` | public | recommended | A real, monitored mailbox. The Contact page then offers topic buttons that open the visitor's e-mail app with the subject filled in; without it the page says its form is not active. Shown publicly; applied at build time |
| `SHOW_DEMO_CONTENT` | server | recommended | `false` in production. Unset ⇒ shown in development, **hidden in a production build** |
| `ANTHROPIC_API_KEY` | **secret** | optional | Enables AI explanations. Server-only |
| `AI_ENABLED`, `AI_MODEL`, `AI_RATE_PER_MINUTE`, `AI_RATE_PER_DAY`, `AI_GLOBAL_PER_DAY`, `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_MS` | server | optional | AI kill switch, model and limits |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | **do not set** | Bypasses RLS; the application does not use it |
| `FAKE_AUTH`, `FAKE_AUTH_*`, `FAKE_ADMIN_EMAILS`, `AI_FAKE` | dev only | never in production | In-memory stand-ins |
| `TEST_DATABASE_URL` | dev/CI | tests | PostgreSQL superuser for the database suites |
| `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | set by Vercel | — | Used to keep previews out of search engines and to derive the site URL |

Rules: never commit `.env.local`; only `NEXT_PUBLIC_*` values reach the browser; setting only one of the two
`NEXT_PUBLIC_SUPABASE_*` values is an error on purpose (a half-configured production site must fail loudly).

## Supabase setup

1. Create a project at supabase.com (choose a region close to your users and to your Vercel functions).
2. **Project Settings → API**: copy the *Project URL* and the **anon / publishable** key. Do **not** copy the service-role key into the app.
3. Apply the migrations ([next section](#database-migrations)).
4. **Authentication → URL Configuration**: *Site URL* = your production origin; *Redirect URLs* = `https://<domain>/az/auth/callback`, `…/ru/auth/callback`, `…/en/auth/callback` (the localized e-mail links land there).
5. **Authentication → Sign In / Providers → Email**: confirm e-mail **on**, minimum password length **10** (the app's own rule).
6. Production e-mail needs a **custom SMTP** provider (Supabase's built-in sender is rate-limited and meant for testing).
7. Create the first admin ([below](#administration-and-data-import)).

The complete, ordered checklist — including the e-mail templates in three languages — is in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Database migrations

`supabase/migrations/` holds 14 ordered, forward-only SQL files (extensions and types → reference tables →
opportunities → translations → RLS → search functions → reference data → profiles → personal plan → admin → sources
and import → audit-log immutability). They are tested on a clean PostgreSQL: the result contains **reference data only**
(12 categories and 14 reference cities: 8 in Azerbaijan, 6 abroad) and no content, user or admin rows.

```bash
supabase link --project-ref <your-project-ref>
supabase db push        # applies pending migrations, in order, one transaction per file
```

- **Never** run `supabase db reset` against a hosted project, and **never** load `supabase/seed.sql` there: that file is demo-only and is used by `supabase db reset` on the local stack.
- Migrations are not edited after being applied; fix forward with a new file.
- Without the CLI, paste the files into the SQL editor one by one, in filename order.

## AI API configuration

AI explanations are **optional**. Rule-based matching (`/matches` and the panel on each opportunity) needs nothing and
always works.

```bash
ANTHROPIC_API_KEY=<your key>       # server-side only; enables the feature
AI_ENABLED=false                   # kill switch (turns AI off even with a key)
AI_MODEL=claude-opus-5-5           # a smaller model is cheaper for short explanations
AI_RATE_PER_MINUTE=5  AI_RATE_PER_DAY=40  AI_GLOBAL_PER_DAY=2000
```

The browser only sends an opportunity id, a task name, its language and an optional ≤ 500-character question. Answers
are grounded in the official record, flagged when they contain unverified numbers, stripped of links, and never stored
as facts. **Limits are per server instance** (see limitations): also set a spend limit at the provider. More:
[`MATCHING.md`](MATCHING.md), [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) §6.

## Administration and data import

`/[locale]/admin` is available only to users with the `admin` role. Roles are granted **by the operator in SQL** — the
application cannot grant them, and a regular user has no way to promote themselves:

```sql
-- after the person has signed up normally; find their id in Authentication → Users
insert into public.user_roles (user_id, role) values ('<auth.users id>', 'admin');
```

Non-admins get a 404 (the page's existence is not revealed). Admin areas: dashboard, opportunities (draft → pending
review → **verify the official source** → publish), organizations, **sources**, **CSV import** (template download,
preview with errors, duplicate detection; imports are *always unverified drafts*), **data quality** (stale
verifications, expired records, missing translations). See [`IMPORT.md`](IMPORT.md) and [`DEMO_GUIDE.md`](DEMO_GUIDE.md).

## Testing

```bash
npm run check          # i18n + types + lint + tests
```

975 automated tests cover validation, search (SQL ≡ TypeScript parity), matching, AI safety, import, SEO metadata,
production-migration hygiene and — against a real PostgreSQL — migrations, row level security and authorization.
The browser audits recorded in [`QA_REPORT.md`](QA_REPORT.md) (Playwright, Lighthouse, axe-core) were run with
throw-away scripts that are **not part of this repository**, so they cannot be re-run from it; only the commands above
are reproducible by you. GitHub Actions runs the same commands on every push and pull request
(`.github/workflows/ci.yml`, with a PostgreSQL service so the database suites really run).

## Deployment

Target: **GitHub → Vercel**, data in **Supabase**. The full step-by-step checklist (GitHub, Supabase, Vercel,
domain, post-deploy verification, rollback, and the decisions only the owner can make) is in
**[`DEPLOYMENT.md`](DEPLOYMENT.md)**. In short:

1. Push to a private GitHub repository; CI must pass.
2. Create the Supabase project, apply the migrations, configure Auth URLs and SMTP.
3. Import the repository in Vercel; set the **Production** variables (`NEXT_PUBLIC_SITE_URL`, the two Supabase values, `SHOW_DEMO_CONTENT=false`; optionally the AI key). Run `npm run preflight`.
4. Add the domain, deploy, then run the smoke tests in `DEPLOYMENT.md` §8.

## Operations: health check and error logs

- `GET /api/health` → `200 {"status":"ok",…}` or `503` when the database does not answer within 3 s; it reveals nothing beyond ok/error. Point an uptime monitor (Vercel, UptimeRobot, Better Stack, …) at it.
- Every unhandled server error is logged as one JSON line with `"event":"request_error"` (error name and message with secrets and e-mail addresses redacted, `digest`, HTTP method, path **without query string**, route). The `digest` is the same reference code the visitor sees on the error page, so support can find the exact failure in the platform's log search. No headers, cookies, bodies or user ids are logged.

## SEO and localized routing

- Every page has a localized `<title>` (`… | TəhsilRadar`), description, canonical URL, Open Graph and Twitter tags, and a share image (`/og.png`).
- `hreflang` links (`az`, `ru`, `en`, `x-default`) appear on indexable pages; an opportunity lists **only the languages in which it really exists**, and a page that falls back to another language is `noindex`.
- Paginated catalogue pages are self-canonical; filtered and search views canonicalise to the plain catalogue.
- `/sitemap.xml` lists the static pages and every real, active opportunity in its available languages (never demo records); `/robots.txt` allows crawling and hides account/admin/API areas.
- **Vercel previews and local runs are never indexed**: `robots.txt` disallows everything and an `X-Robots-Tag: noindex` header is sent.
- Favicon, Apple touch icon and share image are included.

## Known limitations

The honest list is in [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md). The ones that matter most before launch:

- **There is no real content** — all records are demo data; nothing has been verified by a person.
- **No privacy policy or terms page** yet, and the Contact page is only useful once you set `NEXT_PUBLIC_CONTACT_EMAIL` (otherwise it says its form is not active); the owner must provide the address and the legal texts.
- **Rate limits are per server instance** (not shared across serverless instances), and the CSP has no `script-src`.
- **Hosted Supabase, Vercel, GitHub Actions and the real AI provider have not been exercised** by the authors; they were verified only up to their interfaces (a real PostgreSQL 16, local production builds, deterministic stand-ins).

## Documentation map

| File | Contents |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Step-by-step deployment checklist** |
| [`DEMO_GUIDE.md`](DEMO_GUIDE.md) | How to demonstrate the product (10–15 minute script) |
| [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) | What and how |
| [`DATA_MODEL.md`](DATA_MODEL.md) | Schema, RLS, functions |
| [`SECURITY.md`](SECURITY.md) · [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) | Security model and the audit |
| [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md) | Language rules, fallback, SEO |
| [`MATCHING.md`](MATCHING.md) · [`IMPORT.md`](IMPORT.md) | Matching engine · import workflow |
| [`QA_REPORT.md`](QA_REPORT.md) · [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) | Test results · what is open |
| [`ROADMAP.md`](ROADMAP.md) | Phases |

## Conventions

- UI text lives in `src/messages/{az,ru,en}.json`; ESLint rejects literal text in JSX.
- Import `Link`, `usePathname`, `useRouter`, `redirect` from `@/i18n/navigation`, never from `next/link` / `next/navigation`.
- New pages get their metadata from `buildMetadata()` (`src/lib/metadata.ts`); opportunity pages use `buildOpportunityMetadata()`.
- Demo content (`src/features/opportunities/demo-data.ts`) is fictional: organizations are prefixed "Demo", every record is flagged `isDemo`, labelled in the UI and never indexed. **Never add real-looking listings.**
- No secrets in the repository; `.env.example` holds placeholders only (enforced by tests).
