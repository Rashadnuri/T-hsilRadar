# TəhsilRadar — Internationalization (i18n)

Status: Draft v0.1. Locales: `az` (default), `ru`, `en`.

## 1. Principles

1. **Two separate problems:** (a) *UI strings* — static, shipped with the code; (b) *content* — opportunities and organizations, stored in the database. They use different mechanisms.
2. **Never invent.** A missing translation is shown as missing (with a labelled fallback), not generated silently. Facts are never auto-translated into published content without human approval.
3. **Preserve the source.** The original-language text and the official source URL are always retained and visible.
4. **Locale is part of the URL**, so pages are shareable and indexable per language.
5. Azerbaijani is the default and first-class: it is the language the product is designed in and where fallbacks lead for UI.

## 2. Routing

- Library: `next-intl` with App Router (`app/[locale]/...`).
- Locales: `['az','ru','en']`, `defaultLocale: 'az'`, `localePrefix: 'always'` — every URL is `/az/…`, `/ru/…`, `/en/…`. (Always-prefixed is simpler for SEO and caching than hiding the default.)
- `/` redirects (302) to a locale chosen by: (1) `NEXT_LOCALE` cookie, (2) logged-in profile `preferred_locale`, (3) `Accept-Language` best match among az/ru/en, (4) `az`. The redirect is only applied at the root and never to deep links.
- Invalid locale → 404. Locale-neutral paths (`/api`, `/_next`, `/robots.txt`, `/sitemap.xml`, assets) are excluded from the middleware matcher.
- Localized pathnames: **slugs stay language-neutral and ASCII** (`/az/opportunities/demo-stem-summer-school`) — the same slug in every locale — so switching language preserves the page trivially. Route segment names (`opportunities`, `organizations`) are kept in English across locales for MVP (simpler, robust). Localized segment names (e.g. `/ru/vozmozhnosti`) are an explicit non-goal now.

```
/az/opportunities?type=scholarship&scope=international
/ru/opportunities?type=scholarship&scope=international
/en/opportunities/demo-stem-summer-school
```

## 3. Language switcher

- Available in header and footer, shows native names: **Azərbaycan**, **Русский**, **English**.
- Implemented with the locale-aware `Link`/`usePathname`/`useRouter` from `next-intl/navigation`: `router.replace(pathname, { locale })` preserves the current path **and query string** (filters, search, pagination).
- Saves the choice in the `NEXT_LOCALE` cookie and, if logged in, in `profiles.preferred_locale`.
- Opportunity pages: the switcher never 404s. If the target-locale content doesn't exist, the page renders in the target UI language with the original-language content and a notice (see §6).

## 4. UI strings

- Files: `/messages/az.json`, `ru.json`, `en.json`, namespaced by feature (`common`, `nav`, `opportunities`, `auth`, `profile`, `admin`, `errors`, `ai`, `legal`).
- Keys are stable English-based identifiers (`opportunities.filters.deadline`), never sentence text.
- ICU MessageFormat for plurals and variables. **Russian has 3 plural forms (one/few/many/other), Azerbaijani and English use one/other**; every plural key must be written per-locale.
- TypeScript: messages typed from the `az.json` structure (declared `IntlMessages`), so a missing key is a compile error. A CI script checks that all three files have identical key sets and no empty values; it also flags untranslated strings copied verbatim from another language.
- Server Components use `getTranslations`; Client Components receive only the namespaces they need via `NextIntlClientProvider` to keep bundles small.
- No concatenating translated fragments; no text inside images; avoid hard-coded strings in components (ESLint rule/`no-literal-string` in UI folders).
- **Translation quality:** AZ and RU strings are written/reviewed by native speakers. Machine-assisted drafting is permitted for UI strings only when a human reviews them before merge.
- **Banned wording lint** for AI copy (see SECURITY.md §9): phrases implying admission probability are rejected in all three languages.

## 5. Locale-sensitive formatting

Use `Intl` via next-intl's `useFormatter`:
- Dates: `dateStyle: 'long'` per locale; deadlines shown in `Asia/Baku` with the timezone label when the opportunity is abroad or online.
- Relative time ("closes in 5 days") via `Intl.RelativeTimeFormat`.
- Numbers/currency: AZN (₼), USD, EUR, etc. with `Intl.NumberFormat`; always show the currency code from the source and never convert silently.
- Lists via `Intl.ListFormat`.
- Country, language and currency display names via `Intl.DisplayNames` (CLDR data) — no hand-maintained country name tables.
- Sorting: `Intl.Collator(locale)`; in `az` this orders `ç, ş, ğ, ı, ö, ü, ə` correctly.

### Azerbaijani-specific text handling
- **Case mapping:** use `toLocaleLowerCase('az')` / `toLocaleUpperCase('az')` where UI text is case-transformed. The Turkish-family dotted/dotless I (`İ i`, `I ı`) breaks naive `toLowerCase()`. Prefer CSS-free capitalization (author text in correct case).
- **Search normalization:** both stored search vectors and queries are normalized (NFKC, `unaccent`, lowercase with locale rules, `ə→e`, `ı→i`, `ö→o`, `ü→u`, `ç→c`, `ş→s`, `ğ→g` as a *secondary* "folded" match), so users typing on non-Azerbaijani keyboards still find content. Exact diacritic matches rank higher than folded matches.
- Alphabet: Latin Azerbaijani only (modern official). Cyrillic Azerbaijani is not supported. 
- Fonts: choose families covering Latin Extended-A (ə, ğ, ı, ş, ç, ö, ü) and Cyrillic (e.g. Inter, Noto Sans); verify glyph `ə` and `₼` exist. Subset by `latin`, `latin-ext`, `cyrillic`.
- Text length: Russian strings are typically 20–30% longer than English — design components with flexible widths; test with the longest locale.
- HTML: `<html lang="az|ru|en">`; content blocks in another language than the page carry their own `lang` attribute (e.g. original-language fallback text).

## 6. Multilingual content architecture (database content)

### 6.1 Model recap (see DATA_MODEL.md §3.4–3.5, §7)
- **One opportunity = one canonical record.** `opportunities` holds every language-neutral fact (dates, location, funding, eligibility codes, links, statuses). There are never three records for three languages.
- `opportunity_translations(opportunity_id, language, title, short_description, description, requirements, benefits, eligibility, status, translated_from, source_version, …)` holds the text: **one row per language, and a row may be incomplete.** Only `title` is mandatory; a missing field is NULL and stays NULL.
- `organization_translations` and `city_translations` follow the same pattern (names only, only when sourced).
- Enumerated values (type, funding type, location type, education level, field of study, verification status) are **codes** translated through the UI message files, never free text in the DB.
- Implemented in `src/types/translation.ts`, `src/lib/opportunities/translations.ts`, `src/i18n/content-language.ts`.
- **Enforced in the database too** (migrations 3 and 5): a translation row must reference an existing opportunity and is unique per `(opportunity, language)`; translations exist only in `az`/`ru`/`en` (only the `original` row may be in another language); exactly one `original` row, in `original_language`, is required at COMMIT; non-original rows must be translated from the original language; raw HTML is rejected; `machine_draft` rows are invisible to the public roles (RLS). Multilingual keyword search is resolved by the app into codes (`src/lib/opportunities/search-tokens.ts`), so the database never stores UI dictionaries.

### 6.2 Original language vs. interface locales
- `original_language` is the language of the official source text and can be **any ISO 639-1 code** (`az`, `ru`, `en`, but also `de`, `tr`, …). The platform cannot translate its UI into every language, but it must still preserve a German or Turkish original.
- Translations are added only into languages we can review (in practice `az`, `ru`, `en`).
- Exactly one translation row has `status = 'original'`, and its `language` equals `original_language`. It is never overwritten by a translation.
- Language names for labels come from the language itself ("Deutsch", "Türkçe", "Azərbaycanca") via `Intl.DisplayNames`, so a reader who cannot read the page can still recognise the language.

### 6.3 Translation status

| Status | Meaning | Public display |
|--------|---------|----------------|
| `original` | Text of the official source, in its own language | Shown |
| `human` | Translated and reviewed by a person | Shown; no warning |
| `machine_draft` | Machine output, unreviewed | **Never public** (RLS + resolver both exclude it) |
| `machine_approved` | Machine output approved by a moderator | Shown with a "Machine-translated: verify at the official source" notice |
| `outdated` | The original changed after this was written | Shown with a "may be out of date" notice until updated |

### 6.4 Read path: per-field fallback (`resolveContent`)
For a requested language `L`, **each field is resolved independently**:
1. `L`'s row, if its status is public and the field is non-empty (whitespace-only counts as empty);
2. else the **original-language** row's field;
3. else nothing: the field is omitted and listed in `missingFields`. **Nothing is ever generated.**

Rules that follow:
- **No chaining.** The fallback chain is `[L, original]` only — never en → ru → az (`getContentFallbackChain`). A secondary translation could be stale or lower quality and would look authoritative.
- **Every resolved field knows its language** (`ResolvedField.language`, `isFallback`). The page tags that text with `lang="…"`, and labels it in the user's language: card — *"No translation yet — showing the original in Deutsch"*; detail page — a banner listing the languages in use plus a small label above each fallback section.
- A page whose text is not fully in the requested language is `noindex` (§7).
- `machine_approved` / `outdated` text adds its notice; `machine_draft` text is invisible, so a visitor sees the original instead.
- Cards and lists need only title + short description, so only those two fields decide the card label. Language chips (AZ · RU · EN · DE) list the languages with **public** text.
- Search runs over the public rows of **all** languages, so a Russian query finds an Azerbaijani-original record (folded for `ə ı ö ü ç ş ğ`).

Worked examples (all in the demo data and covered by tests):

| Record | Visitor | Result |
|--------|---------|--------|
| original `de`; translations `en` (complete), `az` (title, short, description only); no `ru` | `en` | all English, no notice |
| | `az` | az title/short/description; requirements, benefits, eligibility in German, each section labelled "Deutsch" |
| | `ru` | everything in German, labelled |
| original `az`; `en` human; `ru` **machine_draft** | `ru` | Azerbaijani original — the draft is never shown |
| original `en`; `az` **machine_approved** | `az` | Azerbaijani text with the machine-translation notice |
| original `tr`; only `en` added | `az` / `ru` | Turkish original, labelled "Türkçe" |

### 6.5 Which fields must never be machine-translated without review
Deadlines, amounts, eligibility rules, document lists, URLs, organization names. Structured facts (dates, amounts, countries, levels, funding) are not text at all: they live on the canonical record and are rendered by the UI from codes and `Intl`, so they cannot be mistranslated. Organization names default to the official name in its original language; translated names are accepted only when provided by the organization or verified.

### 6.6 Editorial workflow
1. A moderator enters the original text (language = `original_language`), usually copied from the official source, with the source URL. Publishing needs only the original, with title and short description.
2. The editor shows one tab per language with a status chip and a field-completeness indicator (`getTranslationCoverage`: "3 of 6 fields").
3. Optional "Draft translation with AI" creates a `machine_draft` from the **original only**, instructed not to add or change facts. Automatic checks compare numbers, dates and URLs between source and draft and flag mismatches. A draft never goes public by itself.
4. A person edits and sets `human` (or `machine_approved`).
5. Editing the **original** text increments `content_version`; every reviewed translation becomes `outdated` (still shown, with a notice) until a person updates it (`applyOriginalEdit`). Editing critical facts (deadline, URLs, funding, eligibility) additionally returns the record to `unverified` (DATA_MODEL.md §6.4).
6. Coverage is tracked as a metric (% of published opportunities with AZ / RU / EN).

### 6.7 User-submitted content
Submitters pick the language they wrote in; that becomes `original_language` and the `original` row. Moderators may add translations. Submitters never publish translations directly. All text is validated as restricted Markdown: **raw HTML is rejected at the schema level** (`html_not_allowed`).

## 7. SEO for multilingual pages

Implemented in `src/lib/site.ts`, `src/lib/metadata.ts`, `src/lib/seo/` and verified on a production build (39 page/language combinations, 0 problems — see QA_REPORT.md §7).

- **hreflang** (`az`, `ru`, `en`, `x-default`) on every indexable page. For an opportunity it lists **only the languages in which the page really exists** (no field in fallback, §6.4); `x-default` is `az` when available, otherwise the record's original language, otherwise the first available one. A page that falls back to another language is **`noindex`** and carries **no** hreflang, so hreflang never points at a non-indexable page. Demo records are always `noindex`.
- **Canonical** is the page's own localized absolute URL, built from `NEXT_PUBLIC_SITE_URL` (or Vercel's production/preview address). Filtered and search catalogue views canonicalise to the plain catalogue; a paginated list without filters (`?page=N`) is self-canonical with its own title ("… — page N").
- **Titles and descriptions** are localized per page; the layout's `%s | TəhsilRadar` template applies to every page. Opportunity descriptions use the short description, then the full text, then the title, cut to ≤ 160 characters at a word boundary.
- **Open Graph / Twitter**: `og:locale` = `az_AZ`, `ru_RU`, `en_US` (others as alternates), a language-neutral 1200×630 share image (`/og.png`), `summary_large_image`.
- **Sitemap** (`/sitemap.xml`, rebuilt hourly): static pages in all locales plus every public, **non-demo**, active opportunity in its available languages, each with `xhtml:link` alternates and `lastmod`. If the database cannot be read it degrades to the static pages.
- **robots.txt**: production allows crawling and hides `/api/`, `/*/admin`, `/*/profile`, `/*/my-plan`, `/*/matches`, `/*/auth/`; previews and local runs get `Disallow: /` plus an `X-Robots-Tag: noindex, nofollow` header.
- **Structured data**: a `WebSite` JSON-LD block (name, localized URL, `inLanguage`) on the home page; localized text, ISO 8601 dates.

## 8. Emails, notifications and legal text

- Transactional emails (verification, reset, later reminders) are localized, chosen by `preferred_locale` (fallback: locale at signup). Templates exist as three files each; Supabase Auth email templates are set up per locale (Supabase supports one template set per project → we send through our own sender with locale-aware templates, or use a single template with locale-neutral layout and per-locale text blocks selected via redirect locale; to decide during implementation).
- Privacy policy, terms, cookie notice: three separately authored language versions; legal review per language.

## 9. AI and languages

- The assistant answers in the current UI locale by default, or the language the user writes in. Prompts specify the answer language explicitly.
- AI explanations are cached per locale.
- Evaluation set: a small set of AZ/RU/EN test prompts checks for mixed-language responses, wrong-script output, and banned "probability" wording. Azerbaijani output quality is monitored specifically, as LLM quality is typically lower for AZ than for EN/RU.

## 10. Testing i18n

- Unit: key parity script; plural-form tests for RU; localized date/time formatting in all three languages (`format.test.ts`); content-fallback tests (per-field fallback, no chaining, `machine_draft` never shown, non-interface original languages) in `translations.test.ts` and `demo-data.test.ts`.
- E2E (Playwright): switch language on catalogue with filters and on a detail page; assert path, query, `lang` attribute, and fallback notice.
- Visual: screenshots at 360px for each locale on key pages to catch overflow.
- Manual: native-speaker review checklist before each release that touches copy.

## 11. Adding a fourth language later

Add the locale to `routing.ts`, add `messages/xx.json`, update the interface-locale list (`routing.ts`, `localeMeta`), add DB translations as rows (no schema change to translation tables; content languages are already any ISO 639-1 code), update `hreflang`, sitemap and fonts. Because content is row-based, no structural rework is required. (RTL support would be additional work and is out of scope.)

## Authentication and profile (implemented)

- The visitor's language is part of every auth URL (`/az|ru|en/login`, `/profile`…). Redirects after login, logout, registration, email-link callback and protected-route bounces are all issued with the **current locale**; `?next=` stores a locale-less path and the locale is re-applied.
- Validation and auth errors are **codes**, never prose: Zod/handlers return `validation.*` / `authErrors.*` codes that the UI renders from the az/ru/en message files (parity-checked). Country and language names come from `Intl.DisplayNames` in the active locale.
- The plan (`plan.*`) localizes every label, the seven application statuses, deadline texts (dates are formatted on the server in the opportunity's own time zone) and errors. Opportunity titles use the normal content-language fallback, and unavailable items say so in the visitor's language. Locale is preserved through redirects (`/my-plan` → login → back) and the language switcher.
- Matching and AI (`matching.*`, `ai.*`): every engine explanation is a code mapped to az/ru/en text (a test checks coverage); country, language and list formatting use CLDR in the visitor's language; AI answers are requested in the page language with localized section headings and a script check. Facts are never translated by AI into stored records.
- Admin (`admin.*`): fully localized, including validation codes, workflow reasons and translation states. Translation management rules: admins write az/ru/en sections independently (partial allowed; an empty section is never auto-filled); the original text keeps its own language (any ISO language) and cannot be removed; editing it marks other translations outdated; machine drafts are hidden from the public until an admin explicitly approves them; the coverage chips and "missing: RU" summary show what is absent. Organization names are official and never translated.
- Import (`admin.import.*`): every validator problem is a code rendered in the admin's language with the CSV column named; the CSV carries the original text and az/ru/en translation columns; translations of unknown origin are stored as hidden machine drafts; the original language is preserved and never auto-translated.
- Password-reset/confirmation emails are produced by Supabase Auth; their per-locale templates are still an open question (link targets already carry the locale).
