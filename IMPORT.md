# TəhsilRadar — Opportunity data management and CSV import

Admin area: **Opportunities** (manual entry), **Import** (CSV), **Sources**, **Data quality**, **Organizations**. All in az/ru/en.

## Workflow
1. **Register the source** (`/admin/sources`): organization, official website (https), kind, country, *how the data is obtained* (official API → authorized feed → official website read by a person → manual), notes (terms of use). The platform never scrapes: respect each site's terms and technical restrictions; prefer official APIs and authorized feeds. After a person opens the official page they press "Mark as checked" (stores the date).
2. **Prepare a CSV** from the downloadable template (`/admin/import` → "Download the CSV template"; admin-only endpoint). One row per opportunity; original text and translations are columns (`title_az`, `short_ru`, `description_en`, …). Lists use `|`. Dates: `2030-03-31` / `31.03.2030` (date only = end of that day in the organization's zone) or with a time. Comma- or semicolon-delimited, UTF-8 (BOM fine). ≤ 1 MB, ≤ 200 rows.
3. **Check the file** — nothing is saved. Every row gets a status (ready / ready with warnings / error / duplicate / possible duplicate) and localized, column-level problems.
4. **Import** — the server validates the file again (the preview is never trusted) and creates only importable rows, **always as unverified drafts** with their source and a batch id. Each row is its own transaction; failures are reported per row.
5. **Review** (`/admin/opportunities?batch=<id>`): open each draft, check it against the official page, verify, translate/approve, submit for review, publish. Publishing is impossible without verification, an explicit deadline, an official source and a short original description.

## What the validator checks
- Form rules (the same validator as manual entry): types, enums, countries, cities, funding pairs, https URLs, lengths, no HTML, deadline logic (fixed needs a date, rolling/unknown must not have one, start ≤ deadline, time zone).
- **Organization must exist** (slug or exact name, case/accent-insensitive); the importer never creates organizations.
- **Official source URL is required** and checked offline: https, no credentials, not an IP/local address, not a placeholder domain (example.com…), warnings for shorteners, social media, file-sharing links and for a host that matches no registered source.
- **Deadlines:** passed deadline → warning (it will show as expired and can never be published); > 3 years away → warning; unknown → warning.
- **Duplicates:** same official page (normalised: case, `www.`, trailing slash, tracking parameters, fragment), same slug, or a very similar title in the same organization (any language) — against the catalogue and against earlier rows of the same file. Exact duplicates are never imported; possible duplicates only when the admin opts in.
- **Translations:** missing az/ru/en are reported, never filled. Translations are imported as **hidden machine drafts** unless `translations_reviewed` = yes (they are never public until a person approves them). The ORIGINAL language is az, ru or en and is preserved.
- The template's example row is refused (placeholder domain + "EXAMPLE").

## Expiry and quality
`/admin/quality`: flag verified opportunities whose deadline passed as expired; list verifications older than 90 days; sources overdue for a check; published records missing a translation.

## Not in scope (deliberately)
Automatic crawling/scraping, automatic link checking (a request to a third-party site needs that site's permission; use "Mark as checked"), live API connectors (add per source under its terms, as an `official_api`/`authorized_feed` integration that writes drafts through the same validator), non-az/ru/en original languages in CSV (use manual entry).
