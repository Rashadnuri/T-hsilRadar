# TəhsilRadar — QA report

Quality-assurance audit of the whole platform (phases 0–10). Scope: correctness, multilingual behaviour,
accessibility, data integrity and error handling. The security side is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md);
what is still open is in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

**Bottom line.** No critical defects were found. One high-priority defect (form errors were not announced to
screen readers or keyboard users) and five smaller ones were found and fixed, each with a regression test or
a re-run of the check that found it. The production build, type check, lint, i18n check and all 913 automated
tests pass. What cannot be claimed is listed under [What was not tested](#what-was-not-tested).

## 1. How it was tested

| Layer | Tool | Notes |
|---|---|---|
| Types / lint / i18n | `tsc --noEmit`, ESLint, `npm run i18n:check` | strict TypeScript; `react/jsx-no-literals` forbids hard-coded UI text |
| Unit + DB tests | Vitest (41 files, 913 tests) | database suites run the real migrations on a local **PostgreSQL 16** with a Supabase-like role/`auth` stub |
| Browser | Playwright + Chromium against `next dev` (dev-only fake auth) and `next build && next start` | viewports 320 / 375 / 768 / 1280 px, locales az / ru / en |
| Accessibility | axe-core 4.10.2 (WCAG 2.0/2.1 A + AA, best-practice rules) + manual keyboard script | |
| HTTP probes | `curl` / Playwright request API | authorization, headers, locale routing, hostile input |

All numbers below were produced in this session; none are carried over from earlier phases.

## 2. Results by area

| Area | Evidence | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | ✅ 0 errors |
| ESLint | `eslint .` | ✅ 0 errors, 0 warnings (one unused-variable warning in a test was fixed) |
| Production build | `next build` (run twice: start and end of the audit) | ✅ 124 static pages, all 8 admin routes, 4 API routes, proxy |
| Authentication | browser suite: 123 checks (register, login, logout, reset, confirmation, rate limit, cookie flags, open-redirect set) + 58 unit tests | ✅ |
| Authorization | browser 201 checks (anonymous / regular user / admin × 3 locales × every admin route) + catalogue-driven DB audit (6 tests) | ✅ |
| Supabase RLS | 336 database-tier tests (RLS 30, schema 55, admin 32, sources 11, plan 28, profiles 47, …) | ✅ on PostgreSQL 16; ⚠ not on a hosted Supabase project |
| Admin access | non-admin gets 404, anonymous gets redirect, template download 401/404, role cannot be self-granted | ✅ |
| Opportunity creation / editing | browser 201 (create draft → review → verify → publish rules → edit → unpublish → delete rules, partial translations, localized errors) | ✅ |
| Search and filters | browser 77 on the production build; SQL ≡ TypeScript parity suite (11 tests, incl. **300 random filter combinations**) | ✅ |
| Saved opportunities / application tracking | browser 120 + DB 38 (isolation between users, caps, notes privacy, user switch in one browser) | ✅ |
| Matching engine | browser 85 with AI **off** + 125 with the AI stand-in; matching unit tests | ✅ rule-based matching works with no key |
| AI API security | see SECURITY_AUDIT §6; live probe of limiter and hostile bodies | ✅ |
| CSV import | browser 168; 44 library + 19 handler + 15 DB tests | ✅ |
| Translation management | admin suite (coverage, machine drafts, reviewed state), RLS hides `machine_draft` from the public | ✅ |
| Locale routing / switching / persistence | see §3 | ✅ |
| Mobile responsiveness | 252 page loads, no horizontal overflow at 320 px in any locale | ✅ |
| Accessibility | axe: 126 scans, **0 violations after fixes**; keyboard script 24/24 | ✅ (automated only — see limitations) |
| Error handling | backend unreachable: error boundary, neutral login message, no leaks | ✅ |

### The browser audit in numbers
13 page types (10 public, 3 signed-in user) plus 8 admin pages, each in az / ru / en at 4 viewports =
**252 page loads**, with axe scans at 375 and 1280 px (**126 scans**). For every load the script checked: HTTP 200,
`<html lang>` equals the URL locale, exactly one `<h1>`, no raw message keys / `undefined` / `NaN` on the page,
no horizontal overflow, and no console or page errors.

## 3. Multilingual audit

| Check | How | Result |
|---|---|---|
| Untranslated strings | key parity (994 keys × 3), plus a script that lists values identical to English in az/ru, Cyrillic in az/en, Latin-only ru | ✅ none. The 4 ru and 11 az values identical to English are brand names, an e-mail placeholder, and loanwords az really uses ("Format", "Status", "Demo") |
| Raw keys visible | scanned all 252 loads | ✅ none |
| Overflow from longer Russian text | all pages at 320 px and 375 px in `ru` | ✅ none |
| Localized URLs | every route exists under `/az`, `/ru`, `/en`; an unknown prefix (`/xx/…`) is redirected into the default locale where it ends as a 404; trailing slash → 308; uppercase `RU` → 307 to `/ru` | ✅ |
| Locale negotiation | `Accept-Language`: az→/az, ru→/ru, en→/en, unsupported (de)→/az (default) | ✅ |
| Language persistence | `NEXT_LOCALE` cookie wins over `Accept-Language`; switcher keeps the page *and* the query string (browser suites) | ✅ |
| Translation fallback | missing language falls back to the original with a visible "shown in …" note; machine and outdated translations carry a notice; `machine_draft` never public | ✅ unit (15) + browser + RLS |
| Dates / numbers | same instant shown in the record's own time zone in all locales (`17:18 GMT+4` = `05:18 PM GMT+4`); `800 ₼ aylıq` / `800 AZN в месяц` / `AZN 800 per month` | ✅ |
| Facts not changed by translation | translation table has **no** fact columns (deadline, URLs, amounts, eligibility, location); locale resolution returns text fields only | ✅ enforced by schema, asserted by `data-audit.test.ts` |

Observation (not a defect): Azerbaijani date-times render as `17 dekabr 2026/17:18 GMT+4`. The "/" separator comes from
the browser's CLDR data for `az`, not from our code.

## 4. Data audit

Run against the real schema with the real seed (`supabase/tests/data-audit.test.ts`, 10 tests — kept as a permanent suite).

| Question | Finding |
|---|---|
| Demo records presented as real? | No. Every seeded row has `is_demo = true`; none is verified (a constraint forbids it); cards and detail pages carry a "Demo" badge; detail pages are `noindex`; the sitemap lists **0** demo URLs; `SHOW_DEMO_CONTENT=false` empties the catalogue (browser-tested) |
| Expired opportunities shown as active? | No. State is derived from the deadline at render time, so a passed deadline reads "expired" even if the stored status says otherwise (tested 400 days past every fixed deadline). The seed contains expired examples |
| Records without an official source? | None. A DB constraint refuses publishing without one (the test tries and is refused). Every URL is `https://`, with no credentials or whitespace |
| Duplicate opportunities? | None in the seed by URL, slug or title similarity. The import path detects the same three (and in-file duplicates) |
| Missing / inconsistent translations? | Every record has exactly one original, in its declared original language. The seed deliberately has partial translations to exercise fallback; the admin quality page reports them |
| Real data | **There is none.** All content is fictional demo data; nothing has been verified by a person. See KNOWN_LIMITATIONS |

## 5. Defects found and fixed

| ID | Severity | Area | Defect | Fix | Verified by |
|---|---|---|---|---|---|
| QA-01 | **High** | Accessibility (WCAG 3.3.1, 4.1.3) | After a failed submit, field errors were not linked to their inputs (`aria-invalid` without `aria-describedby`), focus dropped to `<body>`, and nothing announced the error. Affected login, register, reset, profile, plan notes, and every admin form | `ErrorText` links itself to its control; new `FocusFirstError` moves focus to the first invalid field when a submission returns; added to all 9 forms; 3 profile fields use the shared component | keyboard script (24/24) + full re-run of auth 123, admin 201, plan 120, import 168 |
| QA-02 | Medium | Accessibility (axe: serious) | `aria-label` on a `<p>` (opportunity cards, "available in …") is not permitted | Replaced by visually hidden text | axe, 126 scans clean |
| QA-03 | Low | Accessibility (axe: moderate) | Header and footer language switchers were both "Language" landmarks | Footer one has its own label in all 3 languages | axe |
| QA-04 | Medium | Security / data | "Append-only" audit log was only true for API users; `service_role` had `ALL` | Migration 13: revoke, plus a trigger that refuses UPDATE/DELETE/TRUNCATE for every role | `authorization-audit.test.ts` |
| QA-05 | Low | Security | No HSTS; no framing / `<base>` / form-target restriction in a CSP | HSTS + partial CSP in `next.config.ts` | header test + curl |
| QA-06 | Low | Security | `lib/ai/config.ts` and `llm.ts` (handle the API key / SDK) lacked `server-only` | Guard added, plus a test that pins it and forbids client imports | `security.test.ts` |
| QA-07 | Info | Lint | Unused variable in `profiles.test.ts` | Removed | ESLint |

## 6. Test-side corrections (not product defects)
These looked like failures and were investigated; the product was right.
- A browser script expected 5 results for *country = AZ + paid*; the correct answer is 4 (one paid demo record is in the Netherlands).
- The AI browser suite hit HTTP 429 until the per-minute limit was raised for the test run — the limiter working as designed. Default behaviour was verified separately (5 allowed, then 429 with `Retry-After: 60`, per user).
- A first draft of the data-audit test claimed the audit log was immutable but ran against an empty table; it caught nothing until a row existed. That is how QA-04 surfaced.
- The keyboard script first reported 6 "failures": 2 were the real QA-01 defect; 4 were false positives of the script itself (Next's dev-only overlay element, and the search box whose focus ring is drawn on its wrapper). The script was corrected for those, and a stricter-than-needed "extra live region" requirement was dropped because focus-on-first-error plus `aria-describedby` is the recommended pattern.
- A "facts identical across locales" assertion I wrote first was a tautology; it was replaced by a structural check.

One item is **unexplained**: in a `next dev` run, one catalogue check (city chip text "Baku4" without a space) failed once. The same suite passes 77/77 against the production build, and I did not reproduce it in dev again, so the cause is unknown. It is not known to affect production.

## What was not tested
- A real hosted Supabase project (Auth e-mails, PostgREST HTTP layer, JWT handling). RLS and functions were tested on PostgreSQL 16 with a stand-in for `auth`.
- A real Anthropic API call. The AI path runs against a deterministic stand-in; SDK/network errors are unit-tested only.
- Browsers other than Chromium; real phones; screen readers; high-contrast / forced-colours; 200–400 % zoom (320 px reflow was checked instead).
- Performance and load. No Lighthouse or Core Web Vitals run.
- Public pages rendering **real database content** end to end (in fake-auth mode the public catalogue always reads the built-in demo data).

## Verdict
Fit to continue to a pilot with demo data. Not ready to publish real opportunities until the items marked
Medium in KNOWN_LIMITATIONS (shared rate-limit store, script CSP, demo flag default) are handled and the
hosted-Supabase and live-AI paths have been exercised once by a person.

*Update:* the later phase's checks, defects and measurements are in the [addendum](#addendum--deployment-preparation-checks-later-phase) below; the open pre-launch items are in [DEPLOYMENT.md](DEPLOYMENT.md) §1 and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Addendum — deployment-preparation checks (later phase)

Same method, run on production builds in three environment configurations (local-style, Vercel *production*-style,
Vercel *preview*-style). Detailed steps: [DEPLOYMENT.md](DEPLOYMENT.md).

**SEO audit** — 13 page types × 3 languages = **39 real pages**, each checked for: HTTP 200, `<html lang>`, title
(brand suffix, ≤ 70 characters, distinct per language), description (70–160 characters on indexable pages, distinct per
language), canonical, `og:url`/`og:image`/`og:locale`/`og:title`, Twitter card, viewport, icons, exactly one `<h1>`,
`noindex` where required, hreflang set (and its absence on `noindex` pages), JSON-LD on the home page.
Result after the fixes below: **0 problems** (the first run, on the 36 pages that existed then, reported 44 problems — several were one defect repeated per page).

| ID | Severity | Defect found | Fix |
|---|---|---|---|
| D-01 | **High** (SEO) | The title template `%s \| TəhsilRadar` never reached child pages (a later spread overwrote it), so every page except the home page had **no brand** in its `<title>`, some as short as "Contact" | Template set after the spread in the locale layout |
| D-02 | Medium | hreflang for opportunities listed all three languages even where the page is a `noindex` fallback | hreflang only for languages in which the page exists; none on `noindex` pages; `x-default` = original language when `az` is missing |
| D-03 | Medium | The sitemap listed no real opportunities (the code comment promised it "with the database phase") | Sitemap includes public, non-demo, active records in their available languages; degrades gracefully |
| D-04 | Medium | No favicon, Apple touch icon or share image (`public/` was empty → 404s, no link previews) | Icon set + 1200×630 share image added; Open Graph and Twitter tags reference it |
| D-05 | Medium | Vercel previews would have been indexable and would have advertised the production domain | Preview builds: `Disallow: /`, `X-Robots-Tag: noindex`, canonical = the preview's own address |
| D-06 | Medium | An unset `SHOW_DEMO_CONTENT` showed demo records in production | Hidden by default in production builds; preflight rejects `true` |
| D-07 | Low | `?page=2` canonicalised to page 1; Russian home description was 175 characters; opportunity description fell back to the title | Self-canonical paginated pages with their own title; description shortened; description from full text before title |
| D-08 | Low | `.env.example` was incomplete and offered the unused service-role key as a fill-in value | Complete, test-enforced (every variable the code reads is documented); service key now commented out and marked "do not set" |

**Mobile performance** (Lighthouse 12, mobile emulation, simulated slow 4G + 4× CPU, local production build, 2 runs each):

| Page | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/az` home | 91–92 | 100 | 100 | 100 | 0.9 s | 3.2–3.4 s | 140 ms | 0 |
| `/ru` home | 88–92 | 100 | 100 | 100 | 1.1 s | 3.0–3.5 s | 150–170 ms | 0 |
| `/en` home | 89–90 | 100 | 100 | 100 | 0.9 s | 3.4 s | 160–180 ms | 0 |
| `/en/opportunities` | 93–95 | 100 | 100 | 100 | 0.9–1.0 s | 2.9–3.0 s | 50–120 ms | 0 |
| `/az` opportunity (demo) | 95 | 100 | 100 | 66* | 0.9 s | 2.9 s | 70 ms | 0.03 |

\* only because demo records are deliberately `noindex` ("page is blocked from indexing"). LCP is a text element and ~90 % of it
is render delay on the main thread, not network. **A negative result:** preloading only the Latin fonts by splitting Inter
into two instances looked like a win in theory but measured **worse** (performance 82–89) because Next declares both
instances under the family name "Inter" and the browser downloaded the Latin files twice — it was reverted and the
baseline re-measured. (The heaviest font file is latin-ext, ~83 KB, needed on every page for the "ə" of the brand name.)

**Environment configurations verified by build + HTTP:** preview-style (`robots: Disallow: /`, `X-Robots-Tag: noindex, nofollow`
on pages and API, canonical on the preview host), production-style (`Allow: /` + disallow list + sitemap, canonical from
Vercel's production URL, no `X-Robots-Tag`, 0 visible demo mentions, demo URLs 404, empty-catalogue state), and a build
with only one Supabase variable (fails with the intended "half-configured" error).

**Regression after all changes:** 959 automated tests; browser suites auth 123, admin 201, plan 120, import 168, matching 85
(AI off) and 125 (AI on, plus the 2 expected rate-limit "failures" when the limit is raised for the run).
The demo script in [DEMO_GUIDE.md](DEMO_GUIDE.md) was walked through in a browser; the walk-through corrected 7 statements
that had been written from memory — at least seven (e.g. which translations are public, label texts, which search words return results).

**Follow-up improvements (user-value and operations), verified:** (1) *Contact page* — with `NEXT_PUBLIC_CONTACT_EMAIL` set, an e-mail card and four localized `mailto:` links replace the dead form (30 browser checks: 3 languages × 320/1280 px, axe clean, no overflow); unset, the honest notice and form remain (24 checks). (2) *`/api/health`* — 200 in demo mode, 200/503 with a healthy/unreachable database, no error text or host in the response, timeout-bounded; unit-tested. (3) *Structured server-error log* — on a production build with the database down, the visitor's error reference (`digest`) appears in a `request_error` log line, the query string `?q=secretsearchterm` does not. New tests: 16 (975 in total).
