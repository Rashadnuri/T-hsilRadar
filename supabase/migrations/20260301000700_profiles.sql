-- Migration 8/8: user profiles (Supabase Auth integration).
--
-- One row per authenticated user, owned by that user and by nobody else:
--  * RLS: a user can read, create and update ONLY the row whose id is their own auth.uid().
--  * anon has no access at all; there is no public view, no join from any public table.
--  * Private data (education, university, residence…) therefore never leaves the owner's session.
--
-- Profiles are created lazily on first save (INSERT under RLS), not by a SECURITY DEFINER
-- trigger on auth.users: this schema deliberately contains no privileged functions.
-- Email and password live in Supabase Auth (auth.users); they are NOT copied here.

-- ── Validation helpers (immutable, used by CHECK constraints) ───────────────────────────────

-- Tags (skills, interests): ≤ max_items, each trimmed, non-empty, ≤ max_len, no raw HTML, unique ignoring case.
create function public.valid_text_tags(tags text[], max_items integer, max_len integer) returns boolean
language sql immutable parallel safe
as $$
  select tags is not null
    and cardinality(tags) <= max_items
    and not exists (select 1 from unnest(tags) t where t is null or btrim(t) = '' or t <> btrim(t) or length(t) > max_len or public.has_raw_html(t))
    and cardinality(tags) = (select count(distinct lower(t)) from unnest(tags) t)
$$;

-- ISO 3166-1 alpha-2 list that MAY be empty (profiles), ≤ max_items, unique.
create function public.valid_country_list(codes text[], max_items integer) returns boolean
language sql immutable parallel safe
as $$
  select codes is not null
    and cardinality(codes) <= max_items
    and not exists (select 1 from unnest(codes) c where c is null or c !~ '^[A-Z]{2}$')
    and cardinality(codes) = (select count(distinct c) from unnest(codes) c)
$$;

-- Spoken languages: [{ "code": "en", "level": "B2" }, …] — ISO 639-1 code + CEFR level or "native", no extras, no duplicates.
create function public.valid_profile_languages(languages jsonb) returns boolean
language sql immutable parallel safe
as $$
  select languages is not null
    and jsonb_typeof(languages) = 'array'
    and jsonb_array_length(languages) <= 20
    and not exists (
      select 1 from jsonb_array_elements(languages) e
      where jsonb_typeof(e) <> 'object'
         or (e - 'code' - 'level') <> '{}'::jsonb
         or jsonb_typeof(e -> 'code') is distinct from 'string'
         or jsonb_typeof(e -> 'level') is distinct from 'string'
         or (e ->> 'code') !~ '^[a-z]{2}$'
         or (e ->> 'level') not in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native')
    )
    and jsonb_array_length(languages) = (select count(distinct e ->> 'code') from jsonb_array_elements(languages) e)
$$;

-- ── Table ───────────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id                          uuid primary key references auth.users (id) on delete cascade,
  full_name                   text,
  education_level             public.education_level,
  university                  text,
  academic_field              public.field_of_study,
  graduation_year             smallint,
  country_of_residence        text,
  preferred_countries         text[] not null default '{}',
  skills                      text[] not null default '{}',
  languages                   jsonb  not null default '[]'::jsonb,
  career_interests            text[] not null default '{}',
  preferred_opportunity_types text[] not null default '{}',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint profiles_full_name check (full_name is null or (btrim(full_name) <> '' and length(full_name) <= 120 and not public.has_raw_html(full_name))),
  constraint profiles_university check (university is null or (btrim(university) <> '' and length(university) <= 200 and not public.has_raw_html(university))),
  -- Wide static bounds; the application validates the tighter, year-relative range.
  constraint profiles_graduation_year check (graduation_year is null or graduation_year between 1950 and 2100),
  constraint profiles_country_of_residence check (country_of_residence is null or country_of_residence ~ '^[A-Z]{2}$'),
  constraint profiles_preferred_countries check (public.valid_country_list(preferred_countries, 20)),
  constraint profiles_skills check (public.valid_text_tags(skills, 30, 50)),
  constraint profiles_career_interests check (public.valid_text_tags(career_interests, 20, 60)),
  constraint profiles_languages check (public.valid_profile_languages(languages)),
  constraint profiles_preferred_types_shape check (public.valid_text_tags(preferred_opportunity_types, 12, 30))
);

comment on table public.profiles is 'Private per-user profile. RLS: owner-only. Never exposed publicly. Email/password stay in auth.users.';

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Preferred opportunity types must be known (active) categories.
create function public.check_profile_types() returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from unnest(new.preferred_opportunity_types) t
    where not exists (select 1 from public.categories c where c.code = t and c.is_active)
  ) then
    raise exception 'preferred_opportunity_types contains an unknown category' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger profiles_check_types before insert or update of preferred_opportunity_types on public.profiles
  for each row execute function public.check_profile_types();

-- ── Row level security ──────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;

-- Column-level write privileges: a user can never change `id` (ownership) or `created_at`.
grant select on public.profiles to authenticated;
grant insert (id, full_name, education_level, university, academic_field, graduation_year, country_of_residence,
              preferred_countries, skills, languages, career_interests, preferred_opportunity_types)
  on public.profiles to authenticated;
grant update (full_name, education_level, university, academic_field, graduation_year, country_of_residence,
              preferred_countries, skills, languages, career_interests, preferred_opportunity_types)
  on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- `(select auth.uid())` is evaluated once per statement (initPlan), not per row.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No DELETE policy or privilege: a profile disappears only when its auth user is deleted (cascade).
