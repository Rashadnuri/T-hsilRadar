-- Migration 5/7: Row Level Security and privileges.
--
-- Model: DENY BY DEFAULT.
--  * Every table has RLS enabled.
--  * anon and authenticated may only SELECT, and only what the policies below expose.
--  * There are NO insert/update/delete policies and no write privileges for them: public users
--    cannot create, change or delete anything. Writes happen with the service_role key from
--    trusted server code only (it bypasses RLS) until the authentication/admin phase adds
--    moderator policies.
--  * Internal columns (who verified/created/translated a record) are not readable by them.

-- Supabase grants ALL on new tables to anon/authenticated by default; make the safe default
-- explicit for every table created from now on, too.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- fold_text() (used by the public search functions) calls unaccent from the `extensions`
-- schema. Supabase grants this by default; stated here so nothing depends on that.
grant usage on schema extensions to anon, authenticated, service_role;

-- ── The one definition of "publicly visible" ────────────────────────────────────────────────
-- Published AND (verified, or previously verified and since expired, or flagged demo).
-- Unverified non-demo records are never visible. Used by the policy below and mirrored by
-- isPublic() in src/lib/opportunities/status.ts.
create function public.is_publicly_visible(
  p_publication  public.publication_status,
  p_verification public.verification_status,
  p_is_demo      boolean
) returns boolean
language sql immutable parallel safe
as $$
  select p_publication = 'published' and (p_is_demo or p_verification in ('verified', 'expired'))
$$;
grant execute on function public.is_publicly_visible(public.publication_status, public.verification_status, boolean) to anon, authenticated, service_role;

-- ── Enable RLS everywhere ───────────────────────────────────────────────────────────────────
alter table public.categories              enable row level security;
alter table public.cities                  enable row level security;
alter table public.organizations           enable row level security;
alter table public.opportunities           enable row level security;
alter table public.opportunity_categories  enable row level security;
alter table public.opportunity_translations enable row level security;

-- ── Privileges: read-only for public roles, column-restricted where needed ─────────────────
revoke all on public.categories, public.cities, public.organizations, public.opportunities,
              public.opportunity_categories, public.opportunity_translations
  from anon, authenticated;

grant select on public.categories, public.cities, public.organizations, public.opportunity_categories
  to anon, authenticated;

-- verified_by / created_by identify moderators: not public.
grant select (
  id, slug, organization_id, opportunity_type, other_type_label, location_type, country, city_id, city_text,
  education_levels, eligible_fields, eligible_countries,
  funding_type, funding_amount, funding_currency, funding_period, funding_percent,
  participation_fee_amount, participation_fee_currency,
  application_url, official_source_url, application_start_date, application_deadline, deadline_type, deadline_timezone,
  publication_status, verification_status, last_verified_at, original_language, content_version,
  is_demo, featured, published_at, created_at, updated_at
) on public.opportunities to anon, authenticated;

-- translated_by / reviewed_by identify staff: not public.
grant select (
  opportunity_id, language, title, short_description, description, requirements, benefits, eligibility,
  status, translated_from, source_version, reviewed_at, created_at, updated_at
) on public.opportunity_translations to anon, authenticated;

-- The server-side service role manages the data (and bypasses RLS).
grant all on public.categories, public.cities, public.organizations, public.opportunities,
             public.opportunity_categories, public.opportunity_translations
  to service_role;

-- ── Policies (all SELECT-only, for anon and authenticated) ──────────────────────────────────
create policy categories_public_read on public.categories
  for select to anon, authenticated using (is_active);

create policy cities_public_read on public.cities
  for select to anon, authenticated using (true);

-- Only published, verified (or flagged demo) opportunities.
create policy opportunities_public_read on public.opportunities
  for select to anon, authenticated
  using (public.is_publicly_visible(publication_status, verification_status, is_demo));

-- An organization is visible exactly when one of its opportunities is. (The sub-select runs
-- with the caller's RLS, so it sees only visible opportunities.)
create policy organizations_public_read on public.organizations
  for select to anon, authenticated
  using (exists (select 1 from public.opportunities o where o.organization_id = organizations.id));

-- Translations of visible opportunities, excluding unreviewed machine drafts.
create policy translations_public_read on public.opportunity_translations
  for select to anon, authenticated
  using (
    status <> 'machine_draft'
    and exists (select 1 from public.opportunities o where o.id = opportunity_translations.opportunity_id)
  );

create policy opportunity_categories_public_read on public.opportunity_categories
  for select to anon, authenticated
  using (exists (select 1 from public.opportunities o where o.id = opportunity_categories.opportunity_id));
