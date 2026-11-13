# TəhsilRadar — deployment guide and checklist

Target infrastructure: **GitHub** (source + CI) → **Vercel** (hosting) → **Supabase** (PostgreSQL + Auth).

## 0. Read this first: what is and is not verified

**Nothing has been deployed.** This document tells *you* what to do; no step in it has been performed on GitHub,
Vercel or a hosted Supabase project by the authors. Do not announce "deployed" until you have completed
[§8 (smoke tests)](#8-post-deploy-verification) and ticked them off yourself.

| Verified by the authors (locally) | **Not** verified (you must check) |
|---|---|
| Production build (`next build`) in three configurations: local-style, Vercel *production*-style and Vercel *preview*-style environment variables | Anything on Vercel itself: build, domains, regions, headers behind its CDN |
| `robots.txt`, `sitemap.xml`, canonical, hreflang, Open Graph, `noindex` on real HTML of all 3 languages | Search-engine behaviour (Search Console, indexing, rich-result tools) |
| All 14 migrations on a clean PostgreSQL 16 with a Supabase-like role set-up; result = reference data only; RLS/authorization suites | The migrations on a **hosted** Supabase project (they use only `pg_trgm`/`unaccent`, which hosted projects provide) |
| Authentication, plan, admin, import, matching flows in a browser against an in-memory auth stand-in | Real Supabase Auth: e-mail delivery, templates, redirect URLs, rate limits |
| `npm run preflight` against good and bad environments | Your real environment variables (run it yourself, §7) |
| The CI workflow's commands, run locally | The workflow **on GitHub** (`.github/workflows/ci.yml` has never been run there) |
| Mobile Lighthouse on a local production build: performance 88–95, accessibility / best-practices / SEO 100 | Performance on Vercel's CDN with real network conditions |

## 1. Decisions only the owner can make (launch blockers)

Tick these **before** real users arrive. They are product/legal choices the code cannot make for you.

- [ ] **Real content.** The platform ships only fictional demo records. Plan who imports and *verifies* the first real opportunities (Admin → Import / New opportunity → verify the official source → publish). Until then production shows an empty catalogue ("The catalogue is empty for now").
- [ ] **A contact channel.** Without configuration the Contact page says its form is not active ("nothing you type is sent") and no address exists anywhere. Create a real, monitored mailbox and set `NEXT_PUBLIC_CONTACT_EMAIL` (§6): the page then shows an e-mail card with a prefilled subject per topic and hides the dead form. (A form handler would be a separate piece of work.) The site promises a way to report data errors, so this is required.
- [ ] **Privacy policy and terms of use.** The registration form already says they "will be published before registration goes live". The site stores accounts and private profile data; get the texts reviewed by someone qualified for the rules that apply to your users. Only essential cookies are used (session, a UI hint, language) — there is no analytics — but disclose them.
- [ ] **Who is the operator?** Name, address and responsible person for the legal pages and for Supabase/Vercel/Anthropic accounts; use a shared mailbox, not a personal one.
- [ ] **Data-processing agreements / data location.** Supabase (region you pick), Vercel, the e-mail provider and — if enabled — Anthropic all process data. Check each against your obligations.
- [ ] **Accept or fix the open engineering items** in [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md): shared rate-limit store (L-02), script CSP (L-03), monitoring and backups (L-07), independent security review (L-08).

## 2. GitHub

The project directory is **not yet a git repository**.

- [ ] Create the repository (private) and push. From the project root:
  ```bash
  git init -b main
  git add .
  git status                          # read the list: there must be NO .env.local, .next/ or node_modules/
  git ls-files | grep -E '(^|/)\.env' # must print only .env.example
  git commit -m "Initial commit"
  gh repo create <owner>/tahsilradar --private --source=. --push
  ```
- [ ] **Settings → Code security**: enable *Secret scanning*, *Push protection* and *Dependabot alerts* (`.github/dependabot.yml` already schedules weekly update PRs).
- [ ] **Actions** → confirm the **CI** workflow (`verify` job) passes on `main`: i18n parity, types, lint, tests (with a PostgreSQL 16 service), production build, `npm audit --omit=dev`. *This workflow has not been run on GitHub before — expect to fix small things on the first run.*
- [ ] **Settings → Branches**: protect `main` — require pull requests and the **verify** check to pass.
- [ ] Never put production secrets in GitHub (CI needs none: it builds with throw-away values).

## 3. Supabase: project and database

- [ ] Create **two** projects: **production** and **staging** (Vercel previews must not touch production data — §6).
- [ ] Region: choose one close to your users **and** to the Vercel function region you will pick in §6. Store the database password in a password manager.
- [ ] Install the CLI (`supabase`), then for **each** project:
  ```bash
  supabase login
  supabase link --project-ref <project-ref>
  supabase db push          # lists the pending migrations — there must be 14 — and applies them in order
  ```
  No CLI? Open **SQL editor** and run each file of `supabase/migrations/` once, in filename order.
- [ ] **Do not** run `supabase db reset` against a hosted project and **do not** load `supabase/seed.sql` (demo-only).
- [ ] Take a backup point first if the project already holds data (`supabase db dump -f backup.sql`, or the dashboard's backups on paid plans). On a brand-new project there is nothing to lose.
- [ ] **Verify the schema** (SQL editor). Expected results are in the comments:
  ```sql
  -- 1. every table has row level security (expect: no rows)
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  -- 2. no SECURITY DEFINER function in public (expect: no rows)
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef;

  -- 3. reference data only (expect: categories 12, cities 14, every other count 0)
  select 'categories' as t, count(*) from public.categories
  union all select 'cities', count(*) from public.cities
  union all select 'opportunities', count(*) from public.opportunities
  union all select 'organizations', count(*) from public.organizations
  union all select 'profiles', count(*) from public.profiles
  union all select 'user_roles', count(*) from public.user_roles;

  -- 4. the audit log refuses edits (expect: ERROR 'admin_audit_log is append-only')
  --    run inside a transaction you roll back:  begin; update public.admin_audit_log set action = 'x'; rollback;
  ```
- [ ] **Verify the public API is closed.** With your project URL and **anon** key (never the service key):
  ```bash
  curl -s "$SUPABASE_URL/rest/v1/user_roles?select=*"          -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
  curl -s "$SUPABASE_URL/rest/v1/opportunity_sources?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
  curl -s "$SUPABASE_URL/rest/v1/opportunities?select=id"      -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
  ```
  The first two must return a *permission denied* error (or an empty list) — never rows. The third returns `[]` until a verified record is published.
- [ ] **Project Settings → API**: copy the *Project URL* and the **anon / publishable** key. Leave the **service-role / secret** key where it is: the app does not use it and it must not enter Vercel.

## 4. Supabase: authentication settings

Do this **before** the first sign-up test, for production and staging separately.

- [ ] **Authentication → URL Configuration**
  - *Site URL*: the production origin, e.g. `https://tahsilradar.az` (staging: its own address).
  - *Redirect URLs* (all must be listed — the localized e-mail links land here):
    `https://tahsilradar.az/az/auth/callback`, `https://tahsilradar.az/ru/auth/callback`, `https://tahsilradar.az/en/auth/callback`.
  - **Staging project** only: also the preview pattern, e.g. `https://*-<your-vercel-team>.vercel.app/**`, plus `http://localhost:3000/**` for local work. Do **not** add wildcards to the production project.
- [ ] **Sign In / Providers → Email**: *Confirm email* **enabled**; *Minimum password length* **10** (the app enforces 10 itself); disable providers you do not use. If your plan offers leaked-password protection, enable it.
- [ ] **Custom SMTP** (Project Settings → Auth → SMTP). The built-in sender is rate-limited and intended for testing; production sign-up and password reset need a real provider with your own domain (SPF/DKIM configured).
- [ ] **E-mail templates in three languages.** The app stores the user's language at sign-up (`user_metadata.locale` = `az` / `ru` / `en`), so templates can branch on it. Keep `{{ .ConfirmationURL }}` — the app uses the PKCE flow and expects the link to end at `/<locale>/auth/callback`. Example for *Confirm signup* (do the same for *Reset password*):
  ```html
  {{ if eq .Data.locale "ru" }}
    <h2>Подтвердите адрес электронной почты</h2>
    <p><a href="{{ .ConfirmationURL }}">Подтвердить</a></p>
  {{ else if eq .Data.locale "en" }}
    <h2>Confirm your email address</h2>
    <p><a href="{{ .ConfirmationURL }}">Confirm</a></p>
  {{ else }}
    <h2>E-poçt ünvanınızı təsdiqləyin</h2>
    <p><a href="{{ .ConfirmationURL }}">Təsdiqlə</a></p>
  {{ end }}
  ```
  Subject lines are one string per template; use a neutral three-language subject such as `TəhsilRadar — Təsdiqlə / Подтвердить / Confirm`. *This template mechanism is documented by Supabase but was not exercised by the authors.*
- [ ] **Rate limits** (Authentication → Rate Limits): review sign-up/sign-in/e-mail limits; consider CAPTCHA (e.g. Turnstile) if sign-up abuse appears.

## 5. First administrator

Roles are granted by the operator in SQL; the application has no way to do it.

- [ ] Sign up through the **deployed** site (so the confirmation e-mail path is tested too), confirm the e-mail, log in once.
- [ ] Find the user id (Authentication → Users) and run in the SQL editor:
  ```sql
  insert into public.user_roles (user_id, role) values ('<auth.users id>', 'admin');
  ```
- [ ] Verify: `/en/admin` shows the dashboard for this user; a second, ordinary account gets a **404** on `/en/admin`; an anonymous visitor is redirected to the login page.

## 6. Vercel

- [ ] **Add New → Project** → import the GitHub repository. Framework preset **Next.js**; build command and output directory: defaults. Node.js version **22.x** (`package.json` and `.nvmrc` pin it).
- [ ] **Settings → Environment Variables** — set by *environment scope*:

  | Variable | Production | Preview | Notes |
  |---|---|---|---|
  | `NEXT_PUBLIC_SITE_URL` | `https://<your domain>` | **leave unset** | origin only, no path, no trailing slash; must equal the primary domain exactly (with or without `www`) |
  | `NEXT_PUBLIC_SUPABASE_URL` | production project URL | **staging** project URL | |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production anon key | staging anon key | the **anon / publishable** key only |
  | `NEXT_PUBLIC_CONTACT_EMAIL` | your real mailbox | same as Production (or a test mailbox) | shown publicly; applied at build time — redeploy after changing |
  | `SHOW_DEMO_CONTENT` | `false` | `true` (to demo the interface) or `false` | with Supabase configured an unset value is *hidden*; a deployment **without** Supabase (demo-only) shows the labelled demo cards when unset |
  | `ANTHROPIC_API_KEY` | key, marked **Sensitive** | optional separate key, or unset | optional feature |
  | `AI_ENABLED`, `AI_MODEL`, `AI_RATE_*`, … | optional | optional | see `.env.example` |
  | `SUPABASE_SERVICE_ROLE_KEY` | **do not set** | **do not set** | unused by the app; bypasses RLS |
  | `FAKE_AUTH`, `FAKE_*`, `AI_FAKE` | **never** | **never** | development stand-ins |

  - *Settings → Environment Variables → "Automatically expose System Environment Variables"* must stay **on**: the app reads `VERCEL_ENV` / `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` to keep previews out of search engines and to build correct links.
  - `NEXT_PUBLIC_*` values and `SHOW_DEMO_CONTENT` are applied **at build time**: after changing them, redeploy (Deployments → ⋯ → Redeploy, without the build cache).
- [ ] **Why a separate staging Supabase for previews?** Preview deployments run unreviewed branch code and are reachable by anyone with the link (unless protected). They must not read or write production data.
- [ ] **Settings → Functions → Region**: pick the region nearest your Supabase project (default is usually a US region; catalogue and account pages query the database on every request).
- [ ] **Settings → Deployment Protection**: enable *Vercel Authentication* for preview deployments.
- [ ] **Settings → Domains**: add the domain, set the DNS records Vercel shows, wait for the certificate. Make **one** host primary and let the other redirect to it; `NEXT_PUBLIC_SITE_URL` must name the primary host.
- [ ] **Settings → Git**: production branch `main`; preview deployments for pull requests.

## 7. Check the environment before deploying

```bash
vercel env pull .env.production.local --environment=production   # contains secrets: git-ignored; delete afterwards
npm run preflight -- .env.production.local
rm .env.production.local
```
`npm run preflight` exits non-zero on errors and **never prints a value** — only variable names. It blocks: a
missing or non-https / localhost / path-bearing site URL, missing or half-set Supabase variables, a service-role key
in the public anon slot, secret-looking `NEXT_PUBLIC_*` names, `SHOW_DEMO_CONTENT=true`, any development switch, and
malformed AI numbers. It warns when the unused service-role key is set.

- [ ] Preflight reports **0 errors** for the Production environment.

## 8. Post-deploy verification

Replace `DOMAIN`. Tick each only after you saw the result yourself.

**Routing and language**
- [ ] `curl -sI https://DOMAIN/` → redirect to `/az` (or `/ru`, `/en` for a browser whose first language is Russian/English); `curl -sI -H "Accept-Language: ru" https://DOMAIN/` → `/ru`.
- [ ] `/az`, `/ru`, `/en` render with the matching `<html lang>`; the language switcher keeps the current page and filters; reload keeps the language.

**SEO**
- [ ] `https://DOMAIN/robots.txt` → `Allow: /`, the `Disallow:` lines for `/api/`, `/*/admin`, `/*/profile`, `/*/my-plan`, `/*/matches`, `/*/auth/`, and `Sitemap: https://DOMAIN/sitemap.xml`.
- [ ] `https://DOMAIN/sitemap.xml` lists the static pages in 3 languages (12 URLs) plus real opportunities, **no** `demo-` URLs, host = your domain.
- [ ] *View source* of `/en` and `/az/opportunities`: `<title>` ends with `| TəhsilRadar`, `rel="canonical"` is `https://DOMAIN/...`, four `hreflang` links (`az`, `ru`, `en`, `x-default`), `og:image` = `https://DOMAIN/og.png`, no `robots` meta. `/en/login` has `noindex`.
- [ ] A **preview** deployment's `/robots.txt` is `Disallow: /` and its responses carry `X-Robots-Tag: noindex, nofollow`.
- [ ] Favicon appears in the browser tab; pasting the URL into a chat/social tool shows the share image.

**Security headers** — `curl -sI https://DOMAIN/en`
- [ ] `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` present; **no** `X-Powered-By`, **no** `X-Robots-Tag`.

**Data and demo content**
- [ ] `/en/opportunities` shows **no** "Demo" cards and no demo note in the footer; a demo URL such as `/en/opportunities/demo-it-internship` returns **404**.

**Contact and monitoring**
- [ ] `/en/contact`, `/az/contact`, `/ru/contact` show the e-mail card with your address and four working `mailto:` links (no "form is not active" notice). Send yourself a test message.
- [ ] `curl -s https://DOMAIN/api/health` → `{"status":"ok","checks":{"database":"ok"},…}` with HTTP 200. Create an uptime monitor on it (alert by e-mail/SMS to the shared mailbox).
- [ ] Vercel → Logs: search `request_error` to see server errors; the `digest` equals the reference code shown on the visitor's error page.

**Accounts**
- [ ] Register → confirmation e-mail arrives (right language, link works, lands on `/<lang>/profile`) → log out → log in → wrong password shows the neutral message → password reset round-trip works.
- [ ] `/en/my-plan` and `/en/profile` redirect to login when signed out.

**Admin and authorization**
- [ ] §5 verification (admin 200, ordinary user 404, anonymous redirect). `https://DOMAIN/api/admin/import-template` → 401 when anonymous.
- [ ] Create a **test** opportunity as draft → submit for review → verify source → publish → it appears in the catalogue and sitemap (within the hour) → archive and delete the test record.

**AI (only if enabled)**
- [ ] With a key: the AI panel answers on an opportunity page; a burst of >5 requests in a minute gets HTTP 429. Without a key: the panel says it is unavailable and rule-based matching still works.

**Performance**
- [ ] PageSpeed Insights (mobile) for `/az`, `/ru`, `/en`, one catalogue page and one opportunity page. Local reference (simulated slow 4G + 4× CPU, no CDN): performance 88–95, LCP 2.9–3.5 s, CLS 0. Expect better behind Vercel's CDN, but verify.

**Logs**
- [ ] Vercel → Logs: no unexpected errors; Supabase → Logs → Auth/API: no repeated failures.

## 9. Search engines (after the content exists)

- [ ] Google Search Console: add the domain property, verify via DNS, submit `https://DOMAIN/sitemap.xml`, watch *Pages* and *International targeting / hreflang*. (Bing Webmaster Tools optional.)
- [ ] Do not expect indexing of opportunity pages until real, verified records are published — demo records are `noindex` by design.
- [ ] Re-check hreflang and canonicals after the first real records appear (they are generated from the data, and only for languages in which each record really exists).

## 10. Rollback and operations

- **Application rollback**: Vercel → Deployments → pick the last good deployment → *Promote to Production* (instant, no rebuild).
- **Database**: migrations are forward-only. Take a backup before every `supabase db push`; fix mistakes with a **new** migration, never by editing an applied one.
- **Keys**: if a key leaks, rotate it at the provider, update Vercel, redeploy. The anon key is public by design; the AI key and any service key are not.
- **Monitoring**: an uptime monitor on `/api/health`, plus a saved log search for `request_error` (and `health_probe_failed`). Both log lines are structured JSON without personal data. A full error tracker (Sentry or similar) and alert routing are still your decision.
- **Routine**: merge Dependabot PRs after CI passes; run Admin → **Data quality** → *expiry check* regularly (stored status is updated only when an admin runs it; visitors always see passed deadlines as expired); review `admin_audit_log` periodically.
- **Cost control (AI)**: the rate limits are per server instance, so also set a spend cap at the provider and keep `AI_ENABLED=false` as the kill switch.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails with "Supabase is half-configured" | only one of the two `NEXT_PUBLIC_SUPABASE_*` is set — set both or neither |
| Confirmation link goes to the wrong host or "invalid link" | *Site URL* / *Redirect URLs* (§4) do not include the exact origin and `/<lang>/auth/callback`; or `NEXT_PUBLIC_SITE_URL` was set on Preview |
| Production shows an empty catalogue | expected until real records are published (and demo content is hidden); check §3 verification query 3 |
| Demo records visible in production | `SHOW_DEMO_CONTENT=true` somewhere, **or** Supabase is not configured (then demo cards are the only content and are shown on purpose); fix and **redeploy** (build-time value) |
| Catalogue is empty on a Vercel deploy | Supabase is configured but holds no published records, or `SHOW_DEMO_CONTENT=false` is set; for a look-around deploy remove both Supabase variables and the flag |
| `robots.txt` says `Disallow: /` in production | the deployment was built as a Vercel *preview*, or `NEXT_PUBLIC_SITE_URL` points at localhost; run preflight |
| `/admin` is 404 for you | your user has no row in `public.user_roles` (§5) — that is the intended behaviour for non-admins |
| Sign-up e-mails do not arrive | custom SMTP not configured or the provider is rate-limiting (§4) |
