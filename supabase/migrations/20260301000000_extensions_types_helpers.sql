-- TəhsilRadar — migration 1/7: extensions, enum types and small helper functions.
--
-- Conventions (see DATA_MODEL.md):
--  * snake_case in SQL ↔ camelCase in TypeScript.
--  * Closed vocabularies are enums; sets that admins extend are reference tables.
--  * Every public table gets RLS in the migration that creates it or in 20260301000400.

-- Extensions live in the `extensions` schema (Supabase convention).
create schema if not exists extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ── Enum types ──────────────────────────────────────────────────────────────────────────────
create type public.location_type       as enum ('onsite', 'remote', 'hybrid');
create type public.funding_type        as enum ('fully_funded', 'partially_funded', 'paid', 'unpaid', 'tuition_discount', 'not_specified');
create type public.funding_period      as enum ('total', 'monthly', 'yearly');
create type public.deadline_type       as enum ('fixed', 'rolling', 'unknown');
create type public.verification_status as enum ('unverified', 'verified', 'rejected', 'expired');
create type public.publication_status  as enum ('draft', 'in_review', 'published', 'unpublished', 'archived');
create type public.translation_status  as enum ('original', 'human', 'machine_draft', 'machine_approved', 'outdated');
create type public.organization_kind   as enum ('government', 'university', 'bank', 'company', 'it_company', 'ngo', 'international_org');
create type public.education_level     as enum ('high_school', 'bachelor', 'master', 'phd', 'graduate', 'professional');
create type public.field_of_study      as enum (
  'education', 'arts_humanities', 'social_sciences', 'business_law', 'natural_sciences',
  'ict', 'engineering', 'agriculture', 'health', 'services', 'general'
);

-- ── Helper functions ────────────────────────────────────────────────────────────────────────

-- Maintains updated_at on every UPDATE.
create function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raw HTML is never stored: text fields are restricted Markdown, sanitized again on render.
-- (Mirrors RAW_HTML in src/validation/opportunity.ts.)
create function public.has_raw_html(input text) returns boolean
language sql immutable parallel safe
as $$ select coalesce(input ~* '</?[a-z][^>]*>|<!--', false) $$;

-- No duplicate elements (CHECK constraints cannot contain subqueries, so this is a function).
create function public.array_is_unique(arr anyarray) returns boolean
language sql immutable parallel safe
as $$ select cardinality(arr) = (select count(distinct x) from unnest(arr) x) $$;

-- ISO 3166-1 alpha-2 list: non-empty, upper-case, no duplicates (NULL = "not stated").
create function public.valid_country_codes(codes text[]) returns boolean
language sql immutable parallel safe
as $$
  select codes is null or (
    cardinality(codes) > 0
    and not exists (select 1 from unnest(codes) c where c !~ '^[A-Z]{2}$')
    and cardinality(codes) = (select count(distinct c) from unnest(codes) c)
  )
$$;

-- IANA time zone name known to this server.
create function public.valid_timezone(tz text) returns boolean
language plpgsql stable parallel safe
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

-- Search normalisation, the SQL twin of src/utils/fold-text.ts:
-- lower-case, diacritics stripped (ö→o ü→u ç→c ş→s ğ→g, й→и), ə→e, ı→i, İ→i, ё→е.
-- Declared IMMUTABLE (with an explicit dictionary) so it can be used in index expressions.
-- Requires a UTF-8 database with a Unicode-aware locale (Supabase: en_US.UTF-8) for lower().
create function public.fold_text(input text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select translate(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, replace(coalesce(input, ''), 'İ', 'i'))),
    'əıё', 'eiе'
  )
$$;
