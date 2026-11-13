# TəhsilRadar — Data Model

Status: v0.3 — the opportunity model is implemented in TypeScript (types, Zod schemas, helpers, demo records) **and in Supabase PostgreSQL** (`supabase/migrations/*.sql`: tables, constraints, triggers, row level security, search functions; see §15). Tables for authentication-dependent features (profiles, saved opportunities, applications, submissions, reports, audit log, verification records, sources) are designed below but **not created yet**. All created tables live in `public` and have RLS enabled (deny by default).

## 1. Conventions

- Primary keys: `uuid` (`gen_random_uuid()`), except reference tables keyed by a stable `text` code/slug.
- Timestamps: `timestamptz`, UTC in the DB. Deadlines additionally store the IANA zone they were written in (`deadline_timezone`, default `Asia/Baku`).
- `created_at`, `updated_at` on all mutable tables (trigger-maintained).
- Soft-delete only where needed (`archived`); user data is hard-deleted on account deletion.
- Closed, stable sets (types, statuses, funding types) use Postgres enums or `CHECK`; sets admins extend (cities, organizations) are reference tables.
- Naming: the database uses `snake_case`, TypeScript uses the `camelCase` equivalent (`application_deadline` ↔ `applicationDeadline`). One mapping layer in the data service; no other renaming.
- **Language codes are two different things** (see INTERNATIONALIZATION.md §1):
  - *interface locales* — `az`, `ru`, `en` (what the UI is translated into);
  - *content languages* — any ISO 639-1 code stored as `text CHECK (~ '^[a-z]{2}$')`, because the official text of a German or Turkish program is German or Turkish and must be preserved as the original.

## 2. Entity overview

```
auth.users 1─1 profiles 1─* saved_opportunities *─1 opportunities
                  │                                   │
                  └1─* applications *─────────────────┤
                                                      ├1─* opportunity_translations   (one row per language, may be incomplete)
organizations 1─* opportunities                       ├*─1 cities (optional reference)
organizations 1─* organization_translations           ├1─* opportunity_sources
cities 1─* city_translations                          ├1─* verification_records
                                                      
submissions  ───► opportunities (on approval)
import_batches 1─* import_rows ──► opportunities (draft)
ai_match_cache, ai_usage, rate_limits, audit_log, reports
```

**One opportunity = one canonical row** in `opportunities` holding every language-neutral fact. All human-readable text lives in `opportunity_translations`. There are never separate opportunity records per language.

## 3. Core tables

### 3.1 `profiles`
Extends `auth.users` (1:1, same `id`).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK, FK `auth.users` ON DELETE CASCADE | |
| role | text CHECK in (`user`,`moderator`,`admin`) default `user` | Not user-editable (column-level grant / trigger) |
| display_name | text | optional |
| preferred_locale | locale default `az` | |
| education_level | text | `high_school`, `bachelor`, `master`, `phd`, `graduate`, `professional` |
| field_of_study_ids | text[] | refs `fields_of_study.code` |
| graduation_year | int | |
| citizenship_country | char(2) | ISO 3166-1; default `AZ` allowed |
| residence_country | char(2) | |
| birth_year | int | used only for age eligibility; no full DOB stored |
| languages | jsonb | `[{"code":"en","level":"B2"}]` |
| interests | text[] | free tags / category codes |
| preferred_countries | char(2)[] | |
| ai_personalization_consent | boolean default false | required to send profile to LLM |
| onboarding_completed_at | timestamptz | |

Sensitive profile attributes (citizenship, birth year) are optional and used only for eligibility checks.

### 3.2 `organizations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| slug | text unique | ASCII |
| kind | text CHECK | `government`, `university`, `bank`, `company`, `it_company`, `ngo`, `international_org` |
| name | text NOT NULL | **Official name in its original language**; never machine-translated (INTERNATIONALIZATION.md §6.4) |
| country | char(2) | HQ country, ISO 3166-1 |
| website_url | text | official site (https); used to check that sources are on the organization's own domain |
| logo_path | text | Storage path (licensed/provided logos only) |
| verified_at | timestamptz | organization identity confirmed by a moderator |
| is_demo | boolean default false | |

`organization_translations(organization_id, language, name_translated, description)` exists only for names the organization itself publishes in that language (e.g. an official English name). A translated name is accepted only when sourced, never guessed.

### 3.3 Reference data

| Table | Key | Purpose |
|-------|-----|---------|
| `categories` | `code text` (`scholarship`, `internship`, `grant`, `admission`, `exchange`, `training`, `certification`, `summer_school`, `hackathon`, `competition`, `research`, `other`) | The opportunity-type taxonomy: `sort_order`, `is_active`. Labels in az/ru/en live in the UI message files (not duplicated here). Seeded by migration 7; a test fails if it drifts from `OPPORTUNITY_TYPES`. |
| `cities` | `id text` (slug: `baku`, `sumgait`, `ganja`, …) | Reference cities: `country`, `name_az`, `name_ru`, `name_en`, `sort_order`. Azerbaijani cities are first-class (Baku, Sumgait, Ganja, Mingachevir, Shirvan, Lankaran, Shaki, Nakhchivan seeded) next to the international cities in use. Seeded by migration 7. |

**Categories and opportunity types.** An opportunity has ONE *primary category*: its `opportunity_type` (a foreign key to `categories.code`, the denormalized column used for fast filtering and display) and may belong to more through `opportunity_categories(opportunity_id, category_code, is_primary)`. A trigger keeps the primary link in sync with `opportunity_type`; the primary link cannot be edited or removed by hand. The catalogue's `type` filter and the keyword search match **any** category of an opportunity.

Countries are **not** a table: ISO 3166-1 codes plus localized names from `Intl.DisplayNames` (CLDR), so no one maintains 250 × 3 names by hand. Funding types, location types, education levels, fields of study and statuses are Postgres **enums**; their labels live in the message files (`opportunityTypes.*`, `funding.*`, `locationType.*`, `level.*`, `fields.*`, `verification.*`).

A city that is not in `cities` is stored on the opportunity as free text (`city_text`) exactly as published; admins can promote it into `cities` later.

### 3.4 `opportunities` (canonical record, language-neutral facts)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| slug | text unique | ASCII `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80; identical in every locale URL |
| organization_id | uuid FK → organizations NOT NULL | |
| opportunity_type | text NOT NULL, FK → `categories(code)` | primary category: `scholarship`, `internship`, `grant`, `admission`, `exchange`, `training`, `certification`, `summer_school`, `hackathon`, `competition`, `research`, `other` |
| other_type_label | text | required iff type = `other` (original language, ≤ 80) |
| location_type | enum `location_type` NOT NULL | `onsite`, `remote`, `hybrid` |
| country | char(2) | host country. **Required for onsite and hybrid**; NULL allowed only for remote with no host country |
| city_id | text FK → cities | optional; must belong to `country` |
| city_text | text | free text for cities not in `cities`; mutually exclusive with `city_id` |
| education_levels | `education_level[]` (enum array) | subset of `high_school, bachelor, master, phd, graduate, professional`; `{}` = not stated; no duplicates |
| eligible_fields | `field_of_study[]` (enum array) | subset of the 11 ISCED-F broad fields (`education, arts_humanities, social_sciences, business_law, natural_sciences, ict, engineering, agriculture, health, services, general`); `{}` = not restricted/stated |
| eligible_countries | char(2)[] NULL | **NULL = not stated** (nobody is excluded, but eligibility is not claimed). Non-NULL = only these countries; an empty array is invalid |
| funding_type | enum `funding_type` NOT NULL default `not_specified` | see §3.4.1 |
| funding_amount | numeric(14,2) | amount *given to the participant*; requires `funding_currency`; only for fully/partially funded, paid, tuition_discount |
| funding_currency | char(3) | ISO 4217; never converted silently |
| funding_period | enum | `total`, `monthly`, `yearly`; requires an amount |
| funding_percent | smallint 1–100 | only for `tuition_discount` |
| participation_fee_amount / participation_fee_currency | numeric / char(3) | what the participant must **pay** (summer-school fee, exam fee); independent of funding; both or neither |
| application_url | text | https; where to apply |
| official_source_url | text | https; the organization's page that states the facts. **Required to publish** |
| application_start_date | timestamptz | |
| application_deadline | timestamptz | |
| deadline_type | enum | `fixed` (deadline required), `rolling` (none, by design), `unknown` (source silent). `application_deadline` is non-NULL iff `fixed` |
| deadline_timezone | text NOT NULL default `Asia/Baku` | IANA zone the source used. A date-only deadline means the **end of that day** in this zone |
| publication_status | enum `publication_status` NOT NULL default `draft` | see §6 |
| verification_status | enum `verification_status` NOT NULL default `unverified` | see §6 |
| last_verified_at / verified_by | timestamptz / uuid → profiles | set from the latest `verification_records` entry |
| original_language | text NOT NULL | ISO 639-1; language of the official source text — **any** language, not only az/ru/en |
| content_version | int NOT NULL default 1 | incremented when original-language text changes (see §3.5) |
| is_demo | boolean NOT NULL default false | |
| featured | boolean default false | |
| published_at | timestamptz | |
| created_by | uuid → profiles | |
| created_at / updated_at | timestamptz | |

#### 3.4.1 Funding types (what the opportunity gives the participant)

| Code | Meaning |
|------|---------|
| `fully_funded` | all main costs covered |
| `partially_funded` | some costs covered |
| `paid` | the participant receives pay (salary, stipend) |
| `unpaid` | no pay and no funding |
| `tuition_discount` | reduced tuition/fees (`funding_percent` and/or amount) |
| `not_specified` | the source says nothing — never guessed |

A fee the participant pays is **not** a funding type; it is `participation_fee_*`. ("Paid" is ambiguous in Azerbaijani/Russian — "ödənişli / платный" can mean *costs money*. The UI labels are therefore "Haqqı ödənilir / Оплачиваемая" for `paid` and the fee is shown separately as "Participation fee".)

#### 3.4.2 Constraints (mirrored by the Zod schema in `src/validation/opportunity.ts`)

```sql
CHECK ((opportunity_type = 'other') = (other_type_label IS NOT NULL))
CHECK (location_type = 'remote' OR country IS NOT NULL)
CHECK (city_id IS NULL OR city_text IS NULL)
CHECK ((deadline_type = 'fixed') = (application_deadline IS NOT NULL))
CHECK (application_start_date IS NULL OR application_deadline IS NULL OR application_start_date <= application_deadline)
CHECK ((funding_amount IS NULL) = (funding_currency IS NULL))
CHECK (funding_amount IS NULL OR funding_type IN ('fully_funded','partially_funded','paid','tuition_discount'))
CHECK (funding_period IS NULL OR funding_amount IS NOT NULL)
CHECK (funding_percent IS NULL OR funding_type = 'tuition_discount')
CHECK ((participation_fee_amount IS NULL) = (participation_fee_currency IS NULL))
CHECK (eligible_countries IS NULL OR cardinality(eligible_countries) > 0)
CHECK (official_source_url ~ '^https://' AND application_url ~ '^https://')   -- NULL passes; publish rule below
CHECK (original_language ~ '^[a-z]{2}$' AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')

-- Publication invariant (see §6)
CHECK (publication_status <> 'published' OR (
        official_source_url IS NOT NULL
    AND (is_demo OR (verification_status IN ('verified','expired') AND verified_by IS NOT NULL AND last_verified_at IS NOT NULL))))
```

Cross-table rules (triggers): a `published` opportunity must have an `original` translation with a non-empty title and short description (§3.5). Array members are validated by their enum types. A `city_id` must belong to the stated `country` and requires one (row trigger `check_city_country`).

Indexes: `(publication_status, verification_status, application_deadline)`; `(opportunity_type)`; `(country, city_id)`; GIN on `education_levels`, `eligible_fields`, `eligible_countries`; partial index `WHERE publication_status = 'published'`.

**Derived, never stored:** market scope (`azerbaijan` / `international` / `both`) — host country AZ → azerbaijan; other host country → international; remote with no host country → both, narrowed by `eligible_countries`. Implemented as `deriveMarketScope()` and as a SQL generated expression/view column, so it can never drift from the facts.

### 3.5 `opportunity_translations` (localized text, one row per language)

PK `(opportunity_id, language)`.

| Column | Type | Notes |
|--------|------|-------|
| language | text NOT NULL | ISO 639-1; interface locale **or** the original language |
| title | text NOT NULL | ≤ 200 |
| short_description | text | ≤ 400; used on cards and in metadata |
| description | text | full description, restricted Markdown, ≤ 20 000 |
| requirements | text | ≤ 10 000 |
| benefits | text | ≤ 10 000 |
| eligibility | text | human-readable eligibility information (the structured rules are on the opportunity) |
| status | enum `translation_status` NOT NULL | `original`, `human`, `machine_draft`, `machine_approved`, `outdated` |
| translated_from | text | language the text was translated from; NULL for `original`; must be the opportunity's `original_language` |
| source_version | int NOT NULL | the `content_version` this row was written against |
| translated_by / reviewed_by / reviewed_at | uuid / uuid / timestamptz | |
| search_vector | tsvector | maintained by trigger; text-search config by language (`russian`, `english`, otherwise `simple` + `unaccent`) |
| created_at / updated_at | | |

**Rows may be incomplete.** Only `title` is mandatory; every other field is NULL when no text exists. A NULL is never filled with generated text.

Supported locales: **translations exist only in `az`, `ru` and `en`** (`CHECK (status = 'original' OR language IN ('az','ru','en'))`); only the ORIGINAL row may be in another language, so a German or Turkish source text is preserved without pretending the UI supports that language.

Invariants:
- exactly one row with `status = 'original'` per opportunity, and its `language = opportunities.original_language` (partial unique index on `(opportunity_id) WHERE status = 'original'` + trigger);
- an `original` row has no `translated_from`; every other row has one;
- no raw HTML in any text field (CHECK/trigger; the renderer sanitizes Markdown as a second layer);
- `machine_draft` rows are never exposed to anon/authenticated roles (RLS, §8).

Editing the **original** text increments `opportunities.content_version`; in the same transaction every `human`/`machine_approved` row becomes `outdated` (still public, with a notice, until a person updates it) and the original row's `source_version` is set to the new version. Implemented as `applyOriginalEdit()`.

Why one wide translations table instead of JSONB columns or a key/value table: per-language status and review metadata, per-language full-text indexes, simple "which languages are missing" queries, and a fixed set of fields makes completeness trivially checkable. Adding a field is one migration plus one entry in `TRANSLATABLE_FIELDS`.

### 3.6 `opportunity_sources`
Preserves original source information.

| Column | Type |
|--------|------|
| id | uuid PK |
| opportunity_id | FK |
| url | text (https) |
| kind | `official_page`, `application_portal`, `announcement_pdf`, `social_post`, `other` |
| is_primary | boolean (one primary per opportunity, partial unique index; mirrors `official_source_url`) |
| language | text NULL |
| retrieved_at | timestamptz |
| content_hash | text (change detection) |
| snapshot_path | text NULL (archived copy/PDF in Storage) |
| http_status / last_checked_at | int / timestamptz (link health) |

### 3.7 `verification_records`
Append-only history.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| opportunity_id | FK | |
| verifier_id | FK profiles | |
| outcome | `verified`, `rejected`, `needs_changes`, `reverified`, `expired` | |
| checklist | jsonb | `{"sourceIsOfficial":true,"organizationIdentityConfirmed":true,"deadlineMatchesSource":true,"noFeeOrScamSigns":true,"linksWork":true}`; **all five must be true** for `verified` (`verifiedOutcomeSchema`) |
| notes | text | internal only |
| created_at | timestamptz | |

`opportunities.verification_status`, `last_verified_at` and `verified_by` are updated from the latest record by a trigger.

### 3.8 `submissions`
User-contributed proposals before they become opportunities.

`id, submitter_id, payload jsonb (validated), source_url, organization_name_text, status (received|in_review|accepted|rejected|duplicate), reviewer_id, rejection_reason, resulting_opportunity_id, created_at`.
Accepting creates a `draft` opportunity; the submitter never gets write access to published content.

### 3.9 `import_batches` / `import_rows`
`import_batches(id, uploaded_by, filename, row_count, status, created_at)`; `import_rows(id, batch_id, raw jsonb, mapped jsonb, errors jsonb, status, opportunity_id NULL)`. Imports only create `draft` opportunities, requiring `source_url`; a duplicate check compares normalized `source_url` and title similarity (`pg_trgm`).

## 4. User-facing tables

### 4.1 `saved_opportunities`
`(user_id, opportunity_id)` PK, `created_at`. RLS: owner only.

### 4.2 `applications` (tracking)
| Column | Type |
|--------|------|
| id | uuid PK |
| user_id | FK profiles |
| opportunity_id | FK, ON DELETE RESTRICT (opportunities are archived, never hard-deleted) |
| status | `interested`,`preparing`,`applied`,`interview`,`accepted`,`rejected`,`withdrawn` |
| applied_at / decision_at | timestamptz |
| reminder_at | timestamptz NULL |
| notes | text (private) |
| checklist | jsonb (L) |
| UNIQUE | `(user_id, opportunity_id)` |

Private user data: owner-only RLS, never exposed in admin UIs, excluded from analytics.

### 4.3 `reports`
User reports about an opportunity (`wrong info`, `expired`, `scam`, `broken link`). `id, opportunity_id, reporter_id NULL, reason, message, status, handled_by`.

## 5. AI, security and operational tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `ai_match_cache` | cached score + explanation | `user_id, opportunity_id, opportunity_updated_at, profile_hash, locale, score, band, reasons jsonb, gaps jsonb, explanation text, model, created_at` |
| `ai_usage` | cost and quota tracking | `user_id, feature, input_tokens, output_tokens, created_at` |
| `rate_limits` | counters per key/window | `key, window_start, count` |
| `audit_log` | admin actions | `actor_id, action, entity, entity_id, diff jsonb, created_at` (insert-only) |
| `opportunity_embeddings` (L) | pgvector | `opportunity_id, locale, embedding vector(…), model` |

`ai_match_cache` is invalidated naturally when the opportunity's `updated_at` (any fact or text change) or the `profile_hash` changes.

## 6. Status, visibility and expiry model

Three independent concepts — deliberately not merged:

| Concept | Stored? | Values | Who changes it |
|---------|---------|--------|----------------|
| **Publication status** (editorial visibility) | yes | `draft`, `in_review`, `published`, `unpublished`, `archived` | moderators |
| **Verification status** (trust in the data) | yes | `unverified`, `verified`, `rejected`, `expired` | moderators; `expired` also by the expiry job |
| **Application state** (temporal) | **no — derived** | `upcoming`, `open`, `closing_soon`, `rolling`, `deadline_unknown`, `expired` | computed from timestamps and "now" on every read |

### 6.1 State machines (`canTransitionPublication`, `canTransitionVerification`)

```
publication:  draft ─► in_review ─► published ─► unpublished ─► in_review/published
                 ▲         │             └──────► archived ─► draft
                 └─────────┘ (sent back)

verification: unverified ─► verified ─► expired ─► unverified / verified (re-opened round)
                   │            └──────► unverified   (a critical field changed)
                   └──────► rejected ─► unverified      (resubmitted after corrections)
```

A record cannot go `draft → published` directly, and a `rejected` record cannot become `verified` without being re-submitted.

### 6.2 Visibility rules (`isPublic`, `isListable`)

- **Public** (reachable by direct link): `publication_status = 'published'` **and** (`verification_status` ∈ {`verified`, `expired`} **or** `is_demo`).
- **Listable** (shown in lists, search, home): public **and** not expired.
- Expired records stay public (old links keep working and say the opportunity ended) but are never listed as active.
- Demo records are the only exemption from verification; they are flagged everywhere and never claim to be verified.

### 6.3 What "expired" means

- The *stored* `verification_status = 'expired'` means the opportunity has ended. The expiry job sets it after the deadline passes.
- Display logic **never relies on it alone**: an opportunity is expired when the stored status is `expired` **or** a `fixed` deadline has passed. So a stale cache or a late cron can only make a record *more* expired, never less (`getApplicationState`, `getEffectiveVerificationStatus`).
- Deadline semantics: `fixed` + timestamp; date-only source deadlines are stored as the end of that calendar day in `deadline_timezone` (`endOfDayInZone`, DST-safe); `rolling` has none; `unknown` is shown as "deadline not specified" and is **not** treated as open.
- "Closing soon" = ≤ 7 days left (rounded up). "Upcoming" = `application_start_date` in the future.
- Freshness is a separate derived flag, not a status: a verified record whose `last_verified_at` is older than 90 days `needsReverification()` and appears in the moderators' re-check queue.

### 6.4 Publication rules (`getPublicationBlockers`)

A record can be published only when none of these blocks it: `missing_official_source`, `official_source_not_https`, `not_verified` (needs `verified_by` + `last_verified_at`; demo exempt), `missing_organization`, `missing_original_translation`, `missing_title`, `missing_short_description`, `deadline_required` (fixed without a date), `already_expired`.

Editing a published, verified record's **critical fields** — official/application URL, start/deadline/deadline type, funding type/amount/currency/percent, eligible countries, education levels, organization — returns it to `unverified` (`verificationAfterEdit`), so the badge can never vouch for facts nobody re-checked. The change is audit-logged with a diff.

## 7. Localized read path

Content is resolved **per field**, in the database for lists and in TypeScript for detail pages (`resolveContent`), with the same rule:

1. the requested language's row, if its status is public (not `machine_draft`) and the field is non-empty;
2. else the **original-language** row's field;
3. else nothing — the field is omitted and reported in `missingFields`.

It never chains through other translations (en → ru → az). Every resolved field carries the language it is really in, so the UI can set `lang="…"`, label the fallback in the user's language ("No translation yet — showing the original in Deutsch"), and add notices for `machine_approved` and `outdated` text.

```sql
-- illustrative: one row per opportunity for a requested language $1
select o.id,
       coalesce(nullif(btrim(r.title), ''), orig.title)                      as title,
       case when nullif(btrim(r.title), '') is not null then r.language else orig.language end as title_language,
       coalesce(nullif(btrim(r.short_description), ''), nullif(btrim(orig.short_description), '')) as short_description,
       case when nullif(btrim(r.short_description), '') is not null then r.language else orig.language end as short_description_language
from opportunities o
join opportunity_translations orig on orig.opportunity_id = o.id and orig.language = o.original_language
left join opportunity_translations r on r.opportunity_id = o.id and r.language = $1 and r.status <> 'machine_draft';
```

Lists and cards need only title + short description. Search runs over the public rows of **all** languages (so a Russian query finds an Azerbaijani-original record), folded for diacritics (`ə→e`, `ı→i`, …) with exact-diacritic matches ranked higher.

## 8. Row Level Security summary

> **As implemented** (migration 5): RLS is enabled on all six tables; anon and authenticated have **SELECT only** (no INSERT/UPDATE/DELETE/TRUNCATE privileges and no write policies); there is no moderator policy yet because there is no authentication yet — all writes use the `service_role` key from trusted server code. Details in §15. The table below is the target design including the later phases.

| Table | anon | authenticated user | moderator/admin |
|-------|------|--------------------|-----------------|
| opportunities / sources / organizations (public columns) | SELECT where `isPublic` (§6.2) | same | full CRUD (publish needs the §6.4 rules) |
| opportunity_translations | SELECT where the opportunity is public **and** `status <> 'machine_draft'` | same | full CRUD, including drafts |
| categories, cities | SELECT (active categories only) | SELECT | full CRUD |
| profiles | — | SELECT/UPDATE own row (not `role`) | SELECT; role change via RPC (admin only) |
| saved_opportunities, applications | — | CRUD own | no direct read (support access via explicit audited RPC only) |
| submissions | — | INSERT own, SELECT own | full |
| reports | INSERT (rate-limited via function) | INSERT, SELECT own | full |
| verification_records, audit_log, import_*, ai_usage, rate_limits | — | — | admin/moderator only (audit_log insert-only) |
| ai_match_cache | — | SELECT own | — (writes by service role) |

Admin helpers `public.is_admin()` / `public.is_moderator()` are `SECURITY DEFINER` with a fixed `search_path`. Views exposed to anon use `security_invoker = true`. Internal fields (`verification_records.notes`, `created_by`, `verified_by`) are not in anon-readable views. The visibility predicate in §6.2 is implemented once, as an SQL function used by every policy and view.

## 9. Demo data

- Seed records have `is_demo = true`, organizations prefixed "Demo", links on the reserved `example.com`, and `verification_status = 'unverified'` — demo data **never** claims to be verified.
- They are public only while `SHOW_DEMO_CONTENT` is enabled (the app checks it; production sets it to `false`), always render a "Demo" badge/notice, are `noindex`, and are excluded from the sitemap.
- The set deliberately exercises the rules: every opportunity type and location type; Baku, Sumgait and Ganja; an expired record (public by link, never listed); original languages `az`, `en`, **`de` and `tr`**; incomplete translations; a `machine_approved` translation; and a `machine_draft` that must stay invisible.
- Tests (`demo-data.test.ts`) assert that every demo record passes the same validation as real submissions, is flagged and unverified, and that the multilingual behaviours above hold. A CI check fails if a migration seeds non-demo opportunities.

## 10. Data lifecycle and privacy

- Account deletion cascades profile, saved items, applications, AI cache; `submissions` and `reports` are anonymized (`submitter_id` set NULL) to retain moderation history.
- Opportunities are archived, not hard-deleted, to keep links and the audit trail working.
- Retention: `rate_limits` 7 days, `ai_usage` 90 days, `ai_match_cache` 30 days from last use, `audit_log` 2 years.

## 11. Migrations

Plain SQL in `supabase/migrations/` (Supabase CLI conventions), applied in timestamp order:

| File | Contents |
|------|----------|
| `…000000_extensions_types_helpers.sql` | `pg_trgm`, `unaccent` (in `extensions`); all enum types; helpers (`set_updated_at`, `has_raw_html`, `array_is_unique`, `valid_country_codes`, `valid_timezone`, `fold_text`) |
| `…000100_reference_tables.sql` | `categories`, `cities`, `organizations` |
| `…000200_opportunities.sql` | `opportunities` (all checks and trust rules), `opportunity_categories`, indexes, triggers (`updated_at`, `published_at`, primary-category sync/protection) |
| `…000300_translations.sql` | `opportunity_translations` (+ language, original-language and "needs an original at COMMIT" invariants, outdating trigger) |
| `…000400_rls_and_grants.sql` | RLS on every table, read-only policies, column-level grants hiding staff identities, private-by-default future tables, `is_publicly_visible()` |
| `…000500_search_functions.sql` | `opportunity_search_rows`, `search_opportunities`, `catalogue_facets`, `catalogue_filter_options` |
| `…000600_reference_data.sql` | the 12 categories and the cities (reference data needed in every environment — **not** demo data) |

Rules: every migration that creates a table enables RLS for it in the same change set (a test checks this); migrations never seed demo data (`seed.sql` is separate and demo-only); never edit an applied migration — add a new one.

## 12. Code map (implemented)

| Concern | Location |
|---------|----------|
| Domain types and controlled vocabularies | `src/types/opportunity.ts`, `src/types/translation.ts`, `src/types/location.ts` |
| Zod schemas (opportunity, translation, submission invariants, verification checklist, catalogue filters) | `src/validation/opportunity.ts`, `src/validation/opportunity-filters.ts` |
| Deadline / expiration helpers, time zones | `src/lib/opportunities/deadline.ts` |
| Status machines, visibility, publication rules, critical-edit rule | `src/lib/opportunities/status.ts` |
| Translation resolution, fallback, coverage, outdated handling | `src/lib/opportunities/translations.ts` |
| Content-language and locale-fallback helpers | `src/i18n/content-language.ts` |
| Cities, location, market scope, eligibility, funding, slugs, URL safety | `src/lib/opportunities/{cities,location,funding,slug,source}.ts` |
| Demo records | `src/features/opportunities/demo-data.ts` |
| Data-access boundary: services → repositories (Supabase, or the labelled demo data when Supabase is not configured) | `src/services/*`, `src/repositories/*` |
| Supabase clients, env handling, row types, mappers, search-token resolver | `src/lib/supabase/*`, `src/lib/env.ts`, `src/repositories/supabase/*`, `src/lib/opportunities/search-tokens.ts` |
| Migrations, demo seed, database tests | `supabase/migrations/*`, `supabase/seed.sql` (generated by `npm run db:seed:generate`), `supabase/tests/*` |
| Tests | `**/*.test.ts` (`npm test`) |

Validation errors are **stable codes** (`deadline_required`, `city_country_mismatch`, `html_not_allowed`, …) so the UI can localize them and tests can assert them.

## 13. Decisions and trade-offs

| Decision | Why | Cost / mitigation |
|----------|-----|-------------------|
| One canonical row + translation rows | no duplicated facts, one URL/slug, one deadline to verify | joins; solved by a read function/view |
| `original_language` is any ISO 639-1 code | a German/Turkish program's source must be preserved | translations for such records show the original in a language the UI lacks; labelled via `Intl.DisplayNames` |
| Per-field fallback (requested → original) | an incomplete translation still shows what exists in the user's language | a page can mix two languages; each part is `lang`-tagged and labelled, and the page is `noindex` |
| Verification status and temporal state kept separate; `expired` also derived | a stale cache/cron can only make a record *more* expired | the job and the helper must agree on one definition (`isExpired`) |
| Arrays for levels/fields/countries instead of join tables | simple, GIN-indexable, matches the form | no FK integrity → trigger validation; move to join tables if admins must extend the vocabularies |
| `eligible_countries NULL` = not stated | never claims eligibility the source didn't state | UI must show "not specified", not "open to all" |
| Funding = what the participant *receives*; fee separate | removes the paid/"платный" ambiguity | two small fields instead of one |
| Demo exempt from verification, flagged everywhere | lets us test the UI honestly | the exemption is one visible branch (`isDemo`) with tests |

## 14. Open questions

1. Are `grant` and `scholarship` different enough in the UI to keep separate filters, or should the catalogue offer a combined "Scholarships & grants" shortcut (the earlier homepage grouped them)?
2. Should `unknown` deadlines be shown in "open now" results, or only in an explicit "check the source" group? Currently they are *not* treated as open.
3. Do we need multiple deadlines per opportunity (rounds, intakes)? The model assumes one record per intake with a future `series_id`.
4. Who maintains the `cities` list outside Azerbaijan — admins on demand (assumed) or an imported list (e.g. GeoNames)?
5. Should machine-approved translations be allowed for `requirements`/`eligibility` at all, or only for title/description? INTERNATIONALIZATION.md §6.4 currently forbids unreviewed machine text for facts but allows approved text.

## 15. The database as implemented (Supabase PostgreSQL)

### 15.1 What exists
Six tables — `organizations`, `opportunities`, `opportunity_translations`, `categories`, `opportunity_categories`, and the reference table `cities` — plus enums, helper functions and the search functions. Verified on PostgreSQL 16 (Supabase-compatible roles and default privileges are simulated by the test harness). Not created yet: `profiles`, `saved_opportunities`, `applications`, `submissions`, `reports`, `audit_log`, `verification_records`, `opportunity_sources`, imports (they depend on authentication or on the admin phase). `verified_by`, `created_by`, `translated_by` and `reviewed_by` are plain `uuid` columns for now and become foreign keys to `profiles` in the authentication phase.

### 15.2 Invariants enforced by the database (not only by the app)
- **One canonical opportunity**; translations reference it (FK, cascade delete) and are unique per language (PK `(opportunity_id, language)`).
- **Original-language content is preserved**: exactly one `original` row per opportunity, in `original_language`. Checked by a **deferred constraint trigger at COMMIT**, so an opportunity and its translations must be written in one transaction. (Consequence: from `supabase-js`, creating an opportunity needs a single RPC function — planned with the admin phase — not two separate inserts.)
- **Incomplete translations are allowed** (title only); nothing is auto-filled.
- Translation languages are `az`/`ru`/`en`; only the original may be another language. Non-original rows must be translated *from* the original language.
- Editing the original text bumps `content_version`, marks `human`/`machine_approved` translations `outdated`, leaves drafts alone.
- **Trust rules:** `verified` requires `verified_by` and `last_verified_at`; a demo record can never be `verified`; `published` requires an official https source and verification (demo records are the flagged exception). An unverified or rejected record can never be published, and RLS hides it from the public even if that CHECK were bypassed (tested).
- Deadlines (`fixed` ⇔ a date), date order, valid IANA time zone, funding amount/currency/period/percent consistency, https-only links, no raw HTML, length limits, slug format.

### 15.3 Public read access (RLS)
The public sees an opportunity only when `is_publicly_visible(publication_status, verification_status, is_demo)` is true: **published AND (verified, or previously verified and now expired, or flagged demo)**. Organizations are visible exactly when one of their opportunities is; translations only for visible opportunities and never `machine_draft`; category links likewise. `verified_by`/`created_by`/`translated_by`/`reviewed_by` are not readable (column privileges), so repositories select explicit column lists. Public users have no write privileges at all.

### 15.4 Search and filtering in the database
`search_opportunities(p_filters jsonb, p_page, p_page_size, p_now)` returns one page of ids with the total; `catalogue_facets` and `catalogue_filter_options` serve the tabs, city counts and select options. All are `SECURITY INVOKER` (RLS applies), pin `jit = off` (without it PostgreSQL's JIT compiler added ~2 s per call, measured) and take their rules from one function, `opportunity_search_rows`. Multilingual keyword search works by the app resolving each search word into the **codes** whose labels (in any language) contain it (`resolveSearchTokens`); the database never stores UI dictionaries. A parity test runs hundreds of generated cases against the SQL functions and the TypeScript reference implementation and requires identical results, including relevance scores.

### 15.5 Running and testing
```bash
supabase start && supabase db reset        # applies migrations, then supabase/seed.sql (demo only)
npm run db:seed:generate                   # regenerate seed.sql from the demo records
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test   # database suites
```
The database suites create a throw-away database, apply every migration, optionally load the demo seed and drop it afterwards; without a reachable server they are skipped.

### 15.6 Known limits
- Search scans the visible opportunities (fine for the MVP's size); the path to scale is a maintained `search_document` column with trigram/GIN indexes.
- `listSlugs` is capped at PostgREST's row limit (1000); static generation only needs the public set.

## 16. User profiles (authentication phase)

`public.profiles` — one private row per Supabase Auth user (`id` = `auth.users.id`, `on delete cascade`). Email and password stay in Supabase Auth; the profile holds: `full_name`, `education_level`, `university`, `academic_field`, `graduation_year` (1950–2100), `country_of_residence` (ISO 3166-1 alpha-2), `preferred_countries[]`, `skills[]`, `languages` (jsonb `[{code, level}]`, CEFR + native), `career_interests[]`, `preferred_opportunity_types[]`, `created_at`, `updated_at`.

- **RLS:** policies `profiles_select_own / insert_own / update_own`, role `authenticated` only, `id = (select auth.uid())`. `anon` has no privilege at all; nobody but `service_role` can delete (rows go away with the auth user).
- **Column-level grants:** `id` and `created_at` can be set on insert only; update cannot change them.
- **Constraints in the database:** length/size limits, ISO country list shape, language object shape, types validated against active categories (trigger). The app validates the same limits first (Zod, `src/validation/profile.ts`).
- **No SECURITY DEFINER anywhere:** the row is created lazily on first save (upsert), not by an auth trigger.
- Code: `src/types/profile.ts`, `src/repositories/profile/`, tests in `supabase/tests/profiles.test.ts` and `profile-repository.test.ts` (user A/B isolation).

## 17. Personal plan (saved opportunities and applications)

Two private tables, migration `20260301000800_personal_plan.sql`:

| Table | Columns | Rules |
|---|---|---|
| `saved_opportunities` | `id`, `user_id → auth.users` (cascade), `opportunity_id → opportunities` (cascade), `created_at` | `unique (user_id, opportunity_id)` prevents duplicate saves; no UPDATE at all |
| `applications` | `id`, `user_id`, `opportunity_id`, `status application_status`, `notes` (≤ 5000, never blank), `status_changed_at`, `created_at`, `updated_at` | `unique (user_id, opportunity_id)`; `status_changed_at` moves only when the status changes (trigger) |

`application_status` = `interested, preparing, applied, interview, accepted, rejected, withdrawn` (labels are localized in `plan.status.*`; the codes are stable).

- **RLS (owner-only, role `authenticated`, `user_id = (select auth.uid())`):** SELECT/INSERT/DELETE on both tables, UPDATE on `applications`. `anon` has no privilege. Column grants: only `status` and `notes` are updatable; `user_id`, `opportunity_id` and the timestamps never are.
- **Only visible opportunities can be saved or tracked:** the INSERT policy sub-selects `opportunities` under the caller's own RLS, so draft/unpublished ids can't be probed. Existing rows stay readable/editable/deletable by the owner after an opportunity is unpublished (the page shows "no longer available").
- **Expired opportunities** stay in the plan and are shown as expired (deadline derived from `application_deadline`, never from a stored flag).
- **Cap:** 500 rows per user per table (trigger). No SECURITY DEFINER.
- **Privacy:** nothing public reads or joins these tables; `notes` never leaves the owner's session, is not in the browser-side state endpoint, and is not written to logs (`PlanRepositoryError` carries only operation + coarse reason).
- Code: `src/types/plan.ts`, `src/repositories/plan/`, `src/features/plan/`, `src/app/[locale]/my-plan/`, tests in `supabase/tests/plan*.test.ts`.

## 18. Administration (roles, admin write access, audit log)

Migrations `…0900_publication_rejected.sql` and `…1000_admin.sql`.

- **`publication_status`** gains `rejected` (a review outcome). The admin works with five statuses — draft, in_review ("Pending review"), published, rejected, archived; the legacy `unpublished` still exists and is shown as such. **Verification** is shown as verified / unverified (`rejected`/`expired` stay derived).
- **`user_roles(user_id, role)`** — `role` is the enum `app_role` (`admin`). RLS: a user reads **only their own** rows; **no** INSERT/UPDATE/DELETE policy or privilege for anon or authenticated (not even admins). Roles are granted by the operator with service-role/SQL. There is no role column on `profiles`.
- **`is_admin()`** — SECURITY INVOKER; sees the caller's own role row through RLS. Admin policies `to authenticated … using/with check (is_admin())` give admins read-everything (drafts, rejected, machine-draft translations, organizations without public records) and write access to `opportunities`, `opportunity_translations`, `organizations`, `opportunity_categories`. `is_demo` rows are never created/updated through the API.
- **Column grants:** `authenticated` can write only editable columns; `created_by`/`verified_by`/`translated_by`/`reviewed_by` are writable but **not readable**; trigger `guard_verifier` forbids stamping another admin as the verifier.
- **Publishing requirements in the database:** published ⇒ official source URL + verification with verifier and date (existing), **and now** an explicit deadline statement (`deadline_type <> 'unknown'`, demo exempt), plus the existing "original translation with a short description" invariant. Title and organization are NOT NULL; the opportunity type is NOT NULL; a country is required unless the opportunity is remote (the form/handler enforce this as `missing_country`).
- **Admin functions (all SECURITY INVOKER, `to authenticated` only, each calls `admin_require()` and appends to the audit log):** `admin_save_opportunity` (opportunity + translations in ONE transaction; always a draft on create; never changes status, verification or original language), `admin_set_publication_status`, `admin_set_verification`, `admin_review_translation` (approve a machine draft; never touches the original), `admin_delete_opportunity` (refuses published), `admin_save_organization`, `admin_delete_organization` (FK refuses while in use), `admin_list_opportunities` (filters + folded title search + paging), `admin_dashboard_stats`.
- **`admin_audit_log`** — append-only (who, what, which record; no content). Readable by admins only; no UPDATE/DELETE privilege for API roles, and since migration 13 (`audit_log_immutable`) a trigger refuses UPDATE/DELETE/TRUNCATE for every role, `service_role` included.
- Tests: `supabase/tests/admin.test.ts` (roles, RLS, functions, requirements), `admin-repository.test.ts` (handlers + repository on PostgreSQL as admin and as a regular user).

## 19. Sources, imports and data quality

Migrations `…1100_organization_kinds.sql` and `…1200_sources_import.sql`.

- **Organization kinds** now cover every supported origin: `government`, `university` (Azerbaijani vs international is told apart by the country), `bank` (banks and financial institutions), `it_company`, `company` (private companies), `ngo`, `international_org`, plus `scholarship_org` and `development_org`.
- **`opportunity_sources`** — `organization_name`, `website_url` (https, unique), `source_type` (the organization kind), `country`, `access_method` (`official_api` / `authorized_feed` / `official_website` / `manual`), `last_checked_at`, `is_active`, `notes`, optional `organization_id`. Admin-only (RLS `is_admin()`); anon has no privilege. **Nothing fetches these websites**: the platform never scrapes; `last_checked_at` is set only by a person ("mark as checked", never in the future).
- **Provenance on `opportunities`:** `source_id` and `import_batch` (set on creation only; readable by signed-in users but not by anon; never part of the public columns). Imported records are always **unverified drafts**.
- **Functions (SECURITY INVOKER, admin only, audited):** `admin_save_source`, `admin_mark_source_checked`, `admin_delete_source`, `admin_duplicate_index` (compact index for duplicate detection), `admin_import_batches`, `admin_expire_opportunities` (flags VERIFIED opportunities with a passed fixed deadline as `expired`; idempotent; never deletes or unpublishes), `admin_quality_report` (expired-unflagged, verification older than 90 days, sources overdue, published records with missing translations), plus `admin_save_opportunity`/`admin_list_opportunities` extended with provenance and batch filters.
- **Quality principles encoded:** an official source URL is mandatory (also for imports); `last_verified_at` is stored when a person verifies; empty fields stay empty (nothing is invented); a page that still exists never makes an opportunity active — only the deadline and a person's check do.
- Tests: `supabase/tests/sources.test.ts`, `import-repository.test.ts`.
