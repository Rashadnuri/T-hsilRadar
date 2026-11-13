# TəhsilRadar — Technical Architecture

Status: Draft v0.1. Principle: **a boring, managed, single-repo monolith** that two or three developers can run. Complexity is added only when a measured need appears.

## 1. Stack and rationale

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js (App Router), React Server Components | SSR/ISR for SEO, one codebase for UI + server logic, native Vercel support |
| Language | TypeScript, `strict: true` (+ `noUncheckedIndexedAccess`) | Catches data-shape bugs early; DB types are generated |
| Styling | Tailwind CSS | Fast, mobile-first, no custom CSS architecture to maintain |
| Components | shadcn/ui (Radix primitives) | Accessible, copy-in components we own; no heavy dependency |
| i18n | `next-intl` | First-class App Router support, locale routing, typed messages (see INTERNATIONALIZATION.md) |
| DB | Supabase PostgreSQL | Managed Postgres, RLS, SQL search functions, trigram, pgvector later |
| Auth | Supabase Auth (`@supabase/ssr`) | Cookie sessions in Next.js, email + OAuth, no custom auth |
| Validation | Zod | One schema for forms, server actions, API inputs and LLM output |
| Forms | react-hook-form + Zod resolver | Standard with shadcn |
| LLM | Provider behind a thin server-only interface; Anthropic API as the initial provider | Swappable; keys never reach the client |
| Hosting | Vercel (app), Supabase (DB/Auth/Storage) | Zero ops |
| Email | Supabase Auth SMTP via a transactional provider (e.g. Resend) | Needed for verification emails; custom SMTP avoids Supabase's low default limits |
| Rate limiting | Postgres-backed counters initially; Upstash Redis if needed | Avoid new infra until required |
| Testing | Vitest (unit), Playwright (e2e smoke), pgTAP or SQL tests for RLS | Security rules must be tested |
| CI | GitHub Actions: typecheck, lint, test, migration check | Fast feedback |
| Errors/Monitoring | Vercel logs + Sentry (free tier) | Minimal cost |

### Decisions we deliberately did **not** make
- **No separate backend service / microservices.** Route handlers + server actions are enough.
- **No Redis/queue at MVP.** Scheduled work uses Vercel Cron → route handler or Supabase `pg_cron`.
- **No ORM.** Use `supabase-js` with generated types; migrations are plain SQL (Supabase CLI). Fewer layers, RLS applies naturally. Revisit (Drizzle) if query complexity grows.
- **No CMS.** The admin dashboard is the CMS because verification and translation workflow are domain-specific.
- **No vector DB.** pgvector inside Postgres if/when needed.

## 2. High-level diagram

```
 Browser (mobile-first)
     │  HTTPS
     ▼
 Vercel Edge/Node  ── middleware: locale routing, session refresh
     │
     ├── Server Components (read, cached/ISR)  ──┐
     ├── Server Actions (mutations)              ├──► Supabase (Postgres + RLS, Auth, Storage)
     ├── Route Handlers /api/* (AI, cron, hooks) ┘
     │                       │
     │                       └──► LLM provider (server-side only)
     └── Cron (Vercel Cron): expire opportunities, cleanup, link-check
```

## 3. Repository layout (planned)

```
/src
  /app
    /[locale]
      /(public)        home, opportunities, opportunity/[slug], organizations, about
      /(auth)          login, register, reset
      /(account)       profile, saved, applications, recommendations
      /admin           dashboard, review queue, editor, orgs, imports, reports
      layout.tsx
    /api               ai/*, cron/*, health
  /components          ui/ (shadcn), features/*
  /i18n                routing.ts, request.ts, navigation.ts
  /lib
    /supabase          server.ts, client.ts, admin.ts (server-only)
    /ai                provider.ts, prompts/, guardrails.ts, match.ts
    /opportunities     queries.ts, schema.ts (zod), status.ts
    /security          rate-limit.ts, sanitize.ts, authz.ts
  /messages            az.json  ru.json  en.json
/supabase
  /migrations          timestamped SQL
  /seed                demo seed (flagged is_demo)
  /tests               RLS tests
/docs                  (these documents)
```

Feature-oriented folders inside `components/features` and `lib` keep ownership clear without over-engineering.

## 4. Rendering and caching strategy

- **Public catalogue/detail:** Server Components with `revalidate` (ISR, e.g. 5–10 min) plus on-demand `revalidateTag('opportunities')` when an admin publishes/edits. Filtered lists are dynamic but cached per query string at the data layer.
- **Account and admin:** dynamic, `no-store`, auth required.
- **Expiry correctness:** cached pages must never present expired items as active. Rule: *the "active" state is computed at render from `deadline`/current time and never trusted from a cached boolean*, and a cron job also flips stored `status` to `expired`. Detail pages that have a deadline pass `revalidate` ≤ 10 min or compute badge client-side from the deadline timestamp. Queries for lists always include `deadline IS NULL OR deadline > now()` unless `include_expired` is explicit.
- **Static assets/images:** `next/image`, Supabase Storage for logos (with allowed domains).

## 5. Data access pattern

**Implemented** (Supabase phase). Layers, outermost first:

```
pages / features  ──►  services (src/services/*)  ──►  repositories (src/repositories/*)  ──►  Supabase (anon role, RLS)
                                                                    └──────────────────────►  demo records (when Supabase is not configured)
```

1. **Reads of public content:** server-side only, with the **anon** key, through `src/lib/supabase/server.ts` (`import "server-only"`). Row level security is the guard: the public sees only published, verified-or-demo opportunities. There is **no browser Supabase client**: nothing needs one yet (no authentication, no realtime), every page reads on the server. Add `lib/supabase/client.ts` only when a feature genuinely needs it.
2. **Repositories** (`OpportunityRepository`, `OrganizationRepository`) are the only code that knows table and column names. `SupabaseOpportunityRepository` calls the database functions for search/filter/sort/pagination/facets, loads the rows for one page with four small `select`s, maps snake_case rows to the domain model (`mappers.ts`) and, as defence in depth, re-checks `isPublic()` on every record it returns. `DemoOpportunityRepository` serves the labelled demo records and is the reference implementation of the semantics.
3. **Source selection** (`src/repositories/index.ts`): Supabase configured → Supabase; not configured (unset, or `.env.example` placeholders) → demo data; **half-configured → error** (never a silent fallback); configured but failing → `RepositoryError` and the error page (**never** demo data standing in for a broken database).
4. **Services** keep the signatures pages already used, so no page or feature changed when the data source did.
5. **Admin writes and system jobs** (none yet): server-side only with the `service_role` client in `src/lib/supabase/admin.ts` (`server-only`; nothing imports it yet; a test enforces that). Until the authentication phase there are no moderator RLS policies: all writes go through the service role. Multi-row writes (an opportunity plus its translations) must be a single database function call because the "original translation exists" invariant is checked at COMMIT.
6. **User data** (later): server-side with the user's session so RLS enforces ownership.
7. All inputs validated with Zod at the boundary (catalogue filters, submissions); database rows are typed by `src/lib/supabase/types.ts`, whose column lists are checked for completeness at compile time.

Defense in depth: *authorization in the DB (RLS, column privileges, constraints) is primary; app checks are secondary.*

### 5.1 Database layer
- Migrations: `supabase/migrations/` (see DATA_MODEL.md §11, §15). Local stack: `supabase start`, `supabase db reset` (migrations + demo-only `seed.sql`).
- Search runs **in the database** (`search_opportunities`, `catalogue_facets`, `catalogue_filter_options`; SECURITY INVOKER, `jit = off`). The TypeScript implementation (`lib/opportunities/search.ts`) remains as the reference used by the demo repository, and a parity test keeps the two identical.
- Tests: `supabase/tests/*` run against a real PostgreSQL (throw-away databases): schema/constraints/triggers, RLS and privileges, SQL ≡ TypeScript parity, and the repository classes running as the `anon` role. They are skipped when no server is reachable (`TEST_DATABASE_URL`).
- **Not covered by tests:** the HTTP hop (supabase-js → PostgREST). The repository tests use an adapter that runs the same calls as the `anon` role directly on the database, so the SQL, RLS, mapping and repository logic are exercised, but PostgREST itself (JWT role switching, `max_rows`, embedding) is not. Verify against a real Supabase project (or the local stack) before launch.

## 6. Authentication & authorization

- Supabase Auth with `@supabase/ssr`; middleware refreshes sessions. Use `getUser()` (server-validated) not `getSession()` for authorization decisions.
- Roles: `user`, `contributor` (optional later), `moderator`, `admin` stored in `profiles.role`; privileged roles are changeable only by admins via a security-definer function. Role is **never** taken from client-editable user metadata.
- Route protection: middleware gates `/admin` and account routes; each server action re-checks.
- Locale-aware redirects: unauthenticated users go to `/{locale}/login?next=…` (validated against open-redirect).

### 6.1 As implemented

`proxy.ts` (locale + optimistic redirect for `/profile`) → page → `requireUser()` in `src/lib/auth/session.ts` (DAL, `getUser()` against Supabase Auth) → `AuthGateway` / `ProfileRepository`. Server Actions (`src/features/auth/actions.ts`) call pure, unit-tested handlers (`handlers.ts`). Supabase is only reached through `src/lib/auth/supabase-gateway.ts` and the profile repository; there is no browser Supabase client. Public pages stay static: the navbar picks login/logout links from the non-sensitive `tr-auth` cookie client-side.

### 6.2 Personal plan

`/[locale]/my-plan` (protected like the profile) lists the user's own rows from `PlanRepository` and joins them to public opportunities via `OpportunityRepository.getByIds`. Public catalogue and detail pages stay **static**: their save/track buttons read a per-visitor snapshot from `GET /api/my-plan/state` after load (only when the `tr-auth` hint cookie is present). All writes are Server Actions → pure handlers (`src/features/plan/handlers.ts`) → repository.

### 6.3 Matching and AI

`src/lib/matching` (pure rules) → `/[locale]/matches`, `GET /api/matching/[id]`. `src/lib/ai` (config, rate limit, sanitize, facts, prompt, grounding, llm, service) → `POST /api/ai/opportunity`. Details and limits: MATCHING.md.

### 6.4 Admin

`/[locale]/admin{,/opportunities,/opportunities/new,/opportunities/[id]/edit,/organizations}`. Pages call `requireAdmin()` (`src/lib/auth/admin.ts`); Server Actions (`src/features/admin/actions.ts`) call pure handlers (`handlers.ts`: authorize → validate → business rules → repository). `AdminRepository` has a Supabase implementation (RPC functions under the admin's own session) and a development-only in-memory one. Pure rules live in `src/lib/opportunities/status.ts` (transitions, publishing blockers) and `src/lib/admin/*`. See DATA_MODEL.md §18 and SECURITY.md §19.

### 6.5 Import

`src/lib/import/*` (pure: CSV reader, template/columns, offline URL checks, duplicate detection, row validation reusing the admin form validator) → `src/features/admin/import-handlers.ts` (preview/commit, sources, expiry) → Server Actions (`import-actions.ts`) → `/admin/import`, `/admin/sources`, `/admin/quality`. See IMPORT.md.

## 7. Catalogue search and filtering

Implemented in `src/lib/opportunities/search.ts` as **pure functions** over records (unit-tested), behind the service boundary `src/services/opportunities`. The Supabase phase moves the same rules into SQL/RLS; the meaning must not change.

### 7.1 URL contract
The URL is the single source of truth for the catalogue, so every state is shareable and survives a language switch. Invalid, empty or legacy values are dropped silently (never an error page).

| Param | Values | Notes |
|-------|--------|-------|
| `q` | text ≤ 100 | free-text search |
| `scope` | `azerbaijan` \| `international` | dedicated Azerbaijan filter (tabs + panel) |
| `country` | ISO 3166-1 alpha-2 | host country, case-insensitive |
| `city` | reference city id (`baku`, `ganja`, …) | |
| `type` | the 12 opportunity types | |
| `level` | education levels | |
| `field` | the 11 broad fields of study | |
| `funding` | the 6 funding types | |
| `location` | `onsite` \| `remote` \| `hybrid` | |
| `deadline` | `open` \| `week` \| `month` \| `rolling` \| `expired` | |
| `verification` | `verified` \| `unverified` \| `expired` (`rejected` is never public) | |
| `sort` | `relevance` \| `deadline` \| `newest` \| `updated` | default: relevance with a query, else `deadline`; the default is omitted from URLs |
| `page` | ≥ 1 | clamped to the last page |

A client-side GET form (`CleanGetForm`) drops empty values and `page`, so URLs stay short (`/az/opportunities?type=internship&city=ganja`); it also works without JavaScript.

### 7.2 Semantics
- **Filters combine with AND.** Filtering by level, field or country matches only what the source **states**; "not stated" is never treated as "open to everyone" (same principle as eligibility).
- **Expired opportunities never appear as active.** They are returned only on explicit request (`deadline=expired` or `verification=expired`, where "expired" means *ended*: stored status or passed deadline). Expired cards are styled differently (dashed, muted, "Expired", "Ended" label) and have no hover lift.
- **`deadline=open`** = accepting applications (open, closing soon, rolling); upcoming (not yet open) and unknown-deadline records are excluded. `week`/`month` = a fixed deadline within 7/30 days (rounded up).
- **Azerbaijan** = hosted in Azerbaijan, plus remote opportunities open to Azerbaijanis (`deriveMarketScope`). The Azerbaijan tab reveals an Azerbaijan panel: one-click local shortcuts (scholarships, internships, grants) and Azerbaijani cities with counts. Tab and city counts honour every *other* active filter.
- **Sorting.** *Deadline approaching*: soonest fixed deadline first → rolling/unknown → ended (most recently ended first). *Newest*: publication date. *Recently updated*: last edit. *Relevance*: weighted score (query only).

### 7.3 Search
- **Searched:** title (all public languages), organization name, **keywords**, description (short + full). Requirements/benefits are not searched.
- **Keywords are derived, not typed:** the labels of type, location type, funding, education levels, fields, city and country in **all three languages** (`scholarship`, `стипендия`, `təqaüd`, `Баку`, `Germany`). Searching in any language therefore finds records whatever language their text is in.
- **Matching:** every word must match somewhere (AND), folded for case and diacritics (`ə→e`, `ı→i`, `ö→o`, `ü→u`, `ç→c`, `ş→s`, `ğ→g`), substring-based. Weights: title 4 > organization 3 > keywords 2 > description 1.
- **Never searchable:** unreviewed `machine_draft` translations.
- **Database phase:** `unaccent` + `pg_trgm` and one `tsvector` per translation row (`simple` configuration for Azerbaijani, `russian`/`english` where available); the keyword labels become a generated column. If relevance becomes a problem, add Typesense/Meilisearch behind the same service functions.

### 7.4 Preserving state
Pagination, sort, filter chips, scope tabs and city chips are plain links built from the current filters. The language switcher keeps the path and query. The catalogue remembers its last URL (locale-less, in `sessionStorage`), so the detail page's **back link returns to the exact filtered list**, also after a language switch. While a new result set loads, the form is marked `data-pending`: results dim and a screen-reader status announces "Updating results".

## 8. AI architecture

All LLM calls go through `lib/ai/*`, called only from server code (`import 'server-only'`).

### 8.1 Matching: hybrid, deterministic first
1. **Eligibility filter (SQL/TS):** hard constraints — education level, nationality/residency, age, deadline not passed, status published. Failing → excluded or shown as "not eligible: reason".
2. **Rule score (TS):** weighted overlap of field, interests, countries, language skills, funding preference. Produces a 0–100 *fit score* and structured `reasons[]` and `gaps[]`.
3. **LLM explanation (optional, on demand):** receives *only* the structured reasons/gaps and the opportunity's stored fields, and returns a short natural-language explanation in the user's locale. The LLM does **not** decide the score or eligibility.
4. Results cached in `ai_match_cache` keyed by `(user_id, opportunity_id, profile_hash, opportunity_version, locale)`.
5. UI shows bands (Strong / Good / Partial / Low) and never the words "chance", "probability" or "likelihood of admission". Permanent disclaimer on every screen with a score.
6. Later: pgvector embeddings of opportunity text + profile interests to widen candidates; the deterministic gate remains.

### 8.2 Assistant (grounded Q&A)
- Context = single opportunity's fields (+ the user's profile only if the user opted in per request).
- System prompt rules: answer only from provided context; say "not specified" otherwise; never state dates, amounts or requirements not in context; reply in the user's locale; no legal/immigration advice.
- Output is schema-validated (Zod); free text is length-limited and rendered as plain text/safe markdown.

### 8.3 Safety and cost controls
- **Prompt injection:** imported/submitted content is untrusted. It is placed in clearly delimited data blocks, the model has no tools and no ability to take actions, and output is never executed or used to modify records.
- **PII minimization:** send only profile fields needed (no name, email, phone). Document which fields are sent.
- **Rate limits and budgets:** per-user daily quota, per-IP quota for anonymous, global monthly spend cap with a kill switch (env flag).
- **Logging:** log request metadata (user id hash, token counts, latency, feature) not full prompts by default.
- **Fallback:** if the LLM is unavailable, matching still works (scores and reasons without prose).
- **AI translation:** produces `machine_draft` rows only; requires admin approval to publish. Prompt instructs not to add or alter facts; a post-check compares numbers, dates and URLs between source and draft and flags mismatches.

## 9. Background jobs (no queue at MVP)

| Job | Mechanism | Schedule |
|-----|-----------|----------|
| Mark expired opportunities | `pg_cron` SQL update, or Vercel Cron → `/api/cron/expire` (secret-protected) | every 15 min |
| Stale-verification flag (`last_verified_at` older than N days) | same | daily |
| Official link health check | cron route, batch of N | weekly |
| Cleanup of expired AI cache / rate-limit rows | `pg_cron` | daily |
| Deadline reminder emails | later phase | — |

Cron endpoints require a secret header and are idempotent.

## 10. Environments and deployment

- Environments: **local** (Supabase CLI + Docker), **preview** (Vercel preview + a shared Supabase "staging" project), **production**. Production data never used in preview.
- Branching: trunk-based with short-lived feature branches; PRs required to merge to `main`; Vercel previews per PR.
- Migrations: SQL files in `/supabase/migrations`, reviewed in PRs, applied through CI to staging then production. Never edit the production schema by hand.
- Config: environment variables per environment (see SECURITY.md for the list and handling). `.env.example` committed without values.
- Backups: Supabase daily backups (paid tier recommended before launch; PITR when budget allows).

## 11. Observability

- Structured server logs (no PII), Sentry for errors, Vercel Analytics or privacy-friendly analytics (Plausible) for aggregates, a `/api/health` endpoint, admin dashboard counters (pending reviews, stale items).

## 12. Scalability stance

Expected early load is small (thousands of users). The architecture scales by: ISR caching for public pages, indexed Postgres, Supabase compute upgrades, and moving search/AI queues out only when metrics justify. We record these as "scaling triggers" in ROADMAP.md rather than building for them now.

## 13. Key trade-offs

| Decision | Benefit | Cost / Risk | Mitigation |
|----------|---------|-------------|------------|
| Supabase + RLS as the main authorization layer | Fewer bugs from forgotten checks | RLS is easy to misconfigure | Automated RLS tests in CI; deny-by-default |
| No ORM | Simplicity, RLS-friendly | Less abstraction | Typed query helpers, generated types |
| Hybrid deterministic + LLM matching | Explainable, cheap, honest | Less "magic" | Add embeddings later |
| Translation tables vs JSONB columns | Per-language status, indexing, search | More joins | View for localized reads (DATA_MODEL.md) |
| Postgres FTS instead of a search engine | No extra infra | Weaker Azerbaijani relevance | trigram + unaccent; upgrade path defined |
| Monolith in Vercel | Simple | Vercel function limits for long AI calls | Stream responses; keep calls short |
