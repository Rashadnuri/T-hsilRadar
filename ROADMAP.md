# TəhsilRadar — Roadmap

Status: Draft v0.1. Phases are scope boundaries, not date promises. Estimates assume 1–2 developers plus part-time content/moderation help. **Only Phase 0 (documentation) is done in this step; nothing else is implemented.**

## Guiding rules
- Ship the smallest trustworthy version first: a small set of **verified real** Azerbaijani + international opportunities beats a large unverified catalogue.
- Content operations (verification, translation) are as important as code. The admin tools come before the fancy AI.
- Each phase has exit criteria; do not start the next phase until they are met.

## Phase 0 — Product & architecture (current)
Deliverables: PRODUCT_SPEC, ARCHITECTURE, DATA_MODEL, SECURITY, INTERNATIONALIZATION, ROADMAP.
Exit: documents reviewed, open questions below answered or consciously deferred.

## Phase 1 — Foundation (≈ 2 weeks)
- Repo, Next.js + TS strict + Tailwind + shadcn/ui, ESLint/Prettier, CI (typecheck, lint, test).
- Vercel project (preview + prod), Supabase projects (local, staging, prod), env handling, `.env.example`.
- i18n skeleton: `/az /ru /en` routing, language switcher, message files, key-parity check, layout, fonts.
- Supabase Auth wiring, middleware, `profiles` + roles, RLS test harness.
- Core schema migrations (organizations, categories, opportunities, translations, sources, verification) with RLS.
- Demo seed (flagged `is_demo`, fictional orgs, `example.com` URLs).
Exit: user can sign up/in, switch languages preserving page; CI green; RLS tests pass.

> **Status:** the database part is done — Supabase schema, migrations, RLS, SQL search, repositories and database tests (see DATA_MODEL.md §15). Authentication is done too: email/password sign-up, login, logout, password reset, protected routes and private user profiles (see SECURITY.md §16, DATA_MODEL.md §16). Roles/admin are still to do.
>
> **Import workflow done (first version):** CSV import with preview/validation, duplicate detection, sources, expiry detection, review of drafts (IMPORT.md). Still open: API connectors per source, scheduled expiry job. **Admin dashboard done (first version):** roles, RLS, create/edit/review/verify/publish/archive/delete, organizations, translations, audit log (SECURITY.md §19). Still open: CSV import, MFA, expiry cron. **Matching + AI done (first version):** deterministic matching engine with explanations and an optional AI explanation layer (MATCHING.md). Real-provider answer quality still needs native-speaker review. **Personal plan done:** `/[locale]/my-plan` with saved opportunities, application tracking (7 statuses), private notes and deadline display (DATA_MODEL.md §17). Email deadline reminders remain a Phase 7 item.

## Phase 2 — Public catalogue (≈ 3 weeks)
- Opportunity list: filters, text search (unaccent/trigram), sort, pagination, URL-synced state.
- Detail page: all fields, source link, verification badge, language chips, fallback notices, demo banner, expired handling.
- SEO: metadata, hreflang, sitemap, robots, structured data where accurate.
- Report-a-problem; outbound click counter.
Exit: Lighthouse mobile ≥ 90 perf/accessibility on key pages; expired items never shown as active (test coverage).

## Phase 3 — Admin & verification (≈ 3 weeks)
- Admin shell with MFA enforcement, role checks, audit log.
- Opportunity editor with per-language tabs, status chips, validation of publish constraints.
- Verification checklist + records; review queue; publish/unpublish; org management.
- CSV import → draft; duplicate detection.
- Expiry cron + stale-verification cron + link check.
Exit: moderators can take an item from draft to published with full audit trail; first batch of **real, verified** opportunities entered (target 40–60, majority Azerbaijan-based).

## Phase 4 — User features (≈ 3 weeks)
- Profile + onboarding, saved opportunities, application tracking (status, notes, dates).
- User submission form → moderation queue; submitter status view.
- Account deletion.
Exit: full user journeys J1–J3, J6 pass E2E tests.

## Phase 5 — AI features (≈ 3 weeks)
- LLM provider wrapper, quotas, cost cap, kill switch, usage logging.
- Rule-based matching + bands + reasons/gaps UI + permanent disclaimer.
- LLM explanations (cached), grounded per-opportunity assistant.
- AI translation drafts (admin-only, `machine_draft`).
- Prompt-injection and language-quality test set.
Exit: AI wording audit in AZ/RU/EN passes (no probability language); fallback works with the LLM disabled.

## Phase 6 — Hardening & MVP launch (≈ 2 weeks)
- Security checklist (SECURITY.md §14), CSP, headers, pen-test-style review, backups + restore test.
- Legal pages in 3 languages (reviewed), privacy/cookie decisions, `security.txt`.
- Performance and accessibility pass; native-speaker copy review.
- Monitoring: Sentry, uptime, admin counters. Soft launch to a limited audience; feedback loop.
**MVP = Phases 1–6.** Total ≈ 16 weeks of focused work for a small team; trim by deferring submission form or assistant if needed.

## Post-MVP phases (not to be built early)

### Phase 7 — Retention
Email deadline reminders and digests (opt-in), saved searches/alerts, calendar (.ics) export, application checklists, user data export.

### Phase 8 — Content scale
Organization accounts (verified orgs submit/edit their own listings → still moderated), source change monitoring (content-hash diff), semi-automated ingestion from official feeds/RSS with human review, partnerships with universities/ministries/banks.

### Phase 9 — Smarter discovery
pgvector semantic search and matching, "similar opportunities", better Azerbaijani search relevance (external engine if metrics demand), personalized homepage.

### Phase 10 — Growth & monetization (ethical)
PWA / push, Telegram bot (popular in the region), clearly labelled sponsored listings (never affecting verification or match scores), B2B dashboards for institutions, additional languages (e.g. Turkish, Georgian) if demand exists.

### Scaling triggers (when to add infrastructure)
| Signal | Response |
|--------|----------|
| Search p95 > 500 ms or poor AZ relevance | Meilisearch/Typesense |
| LLM calls frequent/long | Queue + background jobs (Supabase queues / Inngest) |
| Cron jobs exceeding platform limits | Dedicated worker |
| DB CPU sustained > 60% | Compute upgrade, query/index tuning, read replica |
| Moderator backlog > 1 week | Contributor roles, better import tooling |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Content ops are the real bottleneck; verification is slow | High | Prioritize admin UX; cap catalogue size at first; recruit part-time moderators |
| Few real opportunities at launch → low value | Medium | Start with well-known, easily verified sources; target quality over volume |
| Weak AZ LLM quality | Medium | Rule-based core; human review; evaluate and pick the provider accordingly |
| Legal/privacy uncertainty | Medium | Legal review before launch; collect minimal data |
| Scope creep (AI, notifications) | High | Phase gates; this roadmap |
| Scraping/copyright concerns for source content | Medium | Store facts + short summaries, link to the official source, no wholesale copying; seek organization permission for logos |

## Open questions (consolidated)

**Product & business**
1. Who is the launch audience first — school-leavers, university students, or young professionals? (Affects content priorities and onboarding.)
2. Who will verify and enter content, and how many hours/week? This sets realistic catalogue size.
3. Is the platform free for users and organizations at launch? Any monetization intent that affects the architecture (sponsored labels)?
4. Should organizations be allowed to self-submit at MVP, or only invited/verified partners plus admin-entered content?
5. Do we need a brand identity (logo, colors) or will design be created from scratch?

**Legal & compliance**
6. Which jurisdiction(s) will the legal entity and data processing fall under? Is a data-protection legal review budgeted (Azerbaijan Personal Data Law, GDPR for EU users)?
7. Is storing citizenship/residence/birth year in profiles acceptable, or should eligibility be asked per-query without persistence?
8. Rules for reproducing text/logos from official sources (permissions, short summaries only?).

**Technical**
9. Supabase region (EU assumed) and whether data residency requirements apply.
10. Which LLM provider/model and monthly budget cap? Is zero-retention API usage required?
11. Auth methods at launch: email + Google only, or also Apple / Facebook / phone OTP?
12. Auth emails per locale: one Supabase template vs custom sender (see INTERNATIONALIZATION.md §8) — decide at implementation.
13. Do we want an `/api` public read API or partner feeds in the future (affects versioning)?
14. Analytics tool choice (Plausible vs Vercel Analytics vs none at launch).

**Internationalization**
15. Are the default-locale redirect rules acceptable (Accept-Language-based at root only)?
16. Policy for fallback pages: `noindex` (chosen in this draft) vs canonical to original — confirm with SEO goals.
17. Who are the native reviewers for AZ and RU copy and legal texts?
18. Should RU/EN opportunity translations be a prerequisite for "featured" status?

**Content model**
19. Do we need a "program → intake/round" structure (the same scholarship reopening each year)? Draft assumes a new opportunity record per intake with a shared `series` link added later; confirm.
20. Which field-of-study taxonomy to use (ISCED-F 2013 suggested) and which education-level scale for Azerbaijan (bachelor/master/PhD plus high-school and vocational)?
