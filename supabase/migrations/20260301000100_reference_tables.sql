-- Migration 2/7: reference tables — categories, cities, organizations.

-- ── categories ──────────────────────────────────────────────────────────────────────────────
-- The opportunity-type taxonomy. `code` is the stable identifier used by the app (labels in
-- az/ru/en live in the UI message files, not here). An opportunity has ONE primary category
-- (its `opportunity_type`) and may belong to more via opportunity_categories.
create table public.categories (
  code        text primary key check (code ~ '^[a-z][a-z_]*$'),
  sort_order  smallint not null default 0,
  is_active   boolean  not null default true,
  created_at  timestamptz not null default now()
);

-- ── cities ──────────────────────────────────────────────────────────────────────────────────
-- Reference cities; Azerbaijani cities are first-class. Names for the three interface locales.
create table public.cities (
  id          text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country     text not null check (country ~ '^[A-Z]{2}$'),
  name_az     text not null check (btrim(name_az) <> ''),
  name_ru     text not null check (btrim(name_ru) <> ''),
  name_en     text not null check (btrim(name_en) <> ''),
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index cities_country_idx on public.cities (country, sort_order);

-- ── organizations ───────────────────────────────────────────────────────────────────────────
create table public.organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  kind         public.organization_kind not null,
  -- Official name in its original language; never machine-translated (INTERNATIONALIZATION.md §6.5).
  name         text not null check (btrim(name) <> '' and length(name) <= 200 and not public.has_raw_html(name)),
  country      text check (country ~ '^[A-Z]{2}$'),
  website_url  text check (website_url ~ '^https://'),
  logo_path    text,
  verified_at  timestamptz,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index organizations_country_idx on public.organizations (country);
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
