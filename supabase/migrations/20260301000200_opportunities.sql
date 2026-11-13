-- Migration 3/7: the canonical opportunity record and its category links.
--
-- ONE opportunity = ONE row here. Everything language-neutral lives on this row; all
-- human-readable text lives in public.opportunity_translations (next migration).

create table public.opportunities (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null,
  organization_id  uuid not null references public.organizations (id) on delete restrict,

  -- Primary category = the opportunity type. Kept in sync with opportunity_categories by trigger.
  opportunity_type text not null references public.categories (code) on update cascade on delete restrict,
  other_type_label text,

  -- Location
  location_type    public.location_type not null,
  country          text,                       -- host country (ISO 3166-1 alpha-2); NULL only for remote
  city_id          text references public.cities (id) on update cascade on delete restrict,
  city_text        text,                       -- city as published, when not in the reference list

  -- Eligibility (structured, language-neutral)
  education_levels public.education_level[] not null default '{}',
  eligible_fields  public.field_of_study[]  not null default '{}',
  eligible_countries text[],                   -- NULL = not stated (nobody excluded, nothing claimed)

  -- Funding: what the participant RECEIVES. A fee the participant pays is separate.
  funding_type     public.funding_type not null default 'not_specified',
  funding_amount   numeric(14, 2),
  funding_currency text,
  funding_period   public.funding_period,
  funding_percent  smallint,
  participation_fee_amount   numeric(14, 2),
  participation_fee_currency text,

  -- Links
  application_url     text,
  official_source_url text,

  -- Dates. A date-only source deadline means the END of that day in deadline_timezone.
  application_start_date timestamptz,
  application_deadline   timestamptz,
  deadline_type          public.deadline_type not null default 'unknown',
  deadline_timezone      text not null default 'Asia/Baku',

  -- Status
  publication_status  public.publication_status  not null default 'draft',
  verification_status public.verification_status not null default 'unverified',
  last_verified_at    timestamptz,
  verified_by         uuid,   -- will reference profiles(id) in the authentication phase

  -- Language
  original_language text not null,          -- ISO 639-1; ANY language (a German page is 'de')
  content_version   integer not null default 1,

  -- Flags & audit
  is_demo      boolean not null default false,
  featured     boolean not null default false,
  published_at timestamptz,
  created_by   uuid,                          -- will reference profiles(id) in the authentication phase
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint opportunities_slug_key unique (slug),
  constraint opportunities_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  constraint opportunities_other_label check ((opportunity_type = 'other') = (other_type_label is not null)),
  constraint opportunities_other_label_text check (other_type_label is null or (btrim(other_type_label) <> '' and length(other_type_label) <= 80 and not public.has_raw_html(other_type_label))),
  constraint opportunities_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint opportunities_location check (location_type = 'remote' or country is not null),
  constraint opportunities_city check (city_id is null or city_text is null),
  constraint opportunities_city_text check (city_text is null or (btrim(city_text) <> '' and length(city_text) <= 100 and not public.has_raw_html(city_text))),
  constraint opportunities_eligible_countries check (public.valid_country_codes(eligible_countries)),
  constraint opportunities_levels_unique check (public.array_is_unique(education_levels)),
  constraint opportunities_fields_unique check (public.array_is_unique(eligible_fields)),

  constraint opportunities_deadline_fixed check ((deadline_type = 'fixed') = (application_deadline is not null)),
  constraint opportunities_dates_order check (application_start_date is null or application_deadline is null or application_start_date <= application_deadline),
  constraint opportunities_timezone check (public.valid_timezone(deadline_timezone)),

  constraint opportunities_funding_amount_currency check ((funding_amount is null) = (funding_currency is null)),
  constraint opportunities_funding_amount_positive check (funding_amount is null or funding_amount > 0),
  constraint opportunities_funding_amount_type check (funding_amount is null or funding_type in ('fully_funded', 'partially_funded', 'paid', 'tuition_discount')),
  constraint opportunities_funding_period check (funding_period is null or funding_amount is not null),
  constraint opportunities_funding_percent check (funding_percent is null or (funding_type = 'tuition_discount' and funding_percent between 1 and 100)),
  constraint opportunities_currency_format check (
    (funding_currency is null or funding_currency ~ '^[A-Z]{3}$') and (participation_fee_currency is null or participation_fee_currency ~ '^[A-Z]{3}$')
  ),
  constraint opportunities_fee check ((participation_fee_amount is null) = (participation_fee_currency is null) and (participation_fee_amount is null or participation_fee_amount > 0)),

  constraint opportunities_urls_https check (
    (application_url is null or application_url ~ '^https://[^\s]+$') and (official_source_url is null or official_source_url ~ '^https://[^\s]+$')
  ),
  constraint opportunities_language_format check (original_language ~ '^[a-z]{2}$'),
  constraint opportunities_content_version check (content_version >= 1),

  -- Trust rules ------------------------------------------------------------------------------
  -- "verified" must say WHO verified it and WHEN, and demo records can never be verified.
  constraint opportunities_verified_has_verifier check (verification_status <> 'verified' or (verified_by is not null and last_verified_at is not null)),
  constraint opportunities_demo_never_verified check (not (is_demo and verification_status = 'verified')),
  -- Publication invariant: official source, and verification (demo records are the flagged exception).
  constraint opportunities_published_requirements check (
    publication_status <> 'published' or (
      official_source_url is not null
      and (is_demo or (verification_status in ('verified', 'expired') and verified_by is not null and last_verified_at is not null))
    )
  )
);

comment on table public.opportunities is 'Canonical opportunity record: one row per opportunity, language-neutral facts only.';
comment on column public.opportunities.opportunity_type is 'Primary category (FK categories.code); mirrored in opportunity_categories by trigger.';
comment on column public.opportunities.eligible_countries is 'NULL = not stated. Never read as "open to everyone".';
comment on column public.opportunities.verification_status is '"expired" = the opportunity ended. Display logic also treats a passed deadline as expired.';
comment on column public.opportunities.verified_by is 'Internal: not readable by anon/authenticated (column privileges).';

-- Indexes (filters, sorting, FK lookups)
create index opportunities_organization_idx on public.opportunities (organization_id);
create index opportunities_type_idx         on public.opportunities (opportunity_type);
create index opportunities_location_idx     on public.opportunities (country, city_id);
create index opportunities_city_idx         on public.opportunities (city_id) where city_id is not null;
create index opportunities_public_idx       on public.opportunities (application_deadline, published_at desc) where publication_status = 'published';
create index opportunities_published_at_idx on public.opportunities (published_at desc nulls last);
create index opportunities_updated_at_idx   on public.opportunities (updated_at desc);
create index opportunities_featured_idx     on public.opportunities (published_at desc) where featured and publication_status = 'published';
create index opportunities_levels_gin       on public.opportunities using gin (education_levels);
create index opportunities_fields_gin       on public.opportunities using gin (eligible_fields);
create index opportunities_countries_gin    on public.opportunities using gin (eligible_countries);

create trigger opportunities_set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

-- A city must belong to the stated host country (and requires one). Row-level because it
-- compares with another table; the foreign key reports unknown cities.
create function public.check_city_country() returns trigger
language plpgsql
as $$
declare
  v_country text;
begin
  if new.city_id is null then
    return new;
  end if;
  select country into v_country from public.cities where id = new.city_id;
  if not found then
    return new; -- the foreign key reports the unknown city
  end if;
  if new.country is null then
    raise exception 'city % requires a host country (%)', new.city_id, v_country using errcode = 'check_violation';
  elsif v_country <> new.country then
    raise exception 'city % belongs to %, not %', new.city_id, v_country, new.country using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger opportunities_check_city_country before insert or update of city_id, country on public.opportunities
  for each row execute function public.check_city_country();

-- published_at is set the first time a record becomes published.
create function public.set_published_at() returns trigger
language plpgsql
as $$
begin
  if new.publication_status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger opportunities_set_published_at before insert or update on public.opportunities
  for each row execute function public.set_published_at();

-- ── opportunity_categories ──────────────────────────────────────────────────────────────────
create table public.opportunity_categories (
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  category_code  text not null references public.categories (code) on update cascade on delete restrict,
  is_primary     boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, category_code)
);
-- At most one primary category per opportunity.
create unique index opportunity_categories_one_primary on public.opportunity_categories (opportunity_id) where is_primary;
create index opportunity_categories_category_idx on public.opportunity_categories (category_code, opportunity_id);

-- Keep the primary category row in sync with opportunities.opportunity_type.
create function public.sync_primary_category() returns trigger
language plpgsql
as $$
begin
  update public.opportunity_categories
     set is_primary = false
   where opportunity_id = new.id and category_code <> new.opportunity_type and is_primary;
  insert into public.opportunity_categories (opportunity_id, category_code, is_primary)
  values (new.id, new.opportunity_type, true)
  on conflict (opportunity_id, category_code) do update set is_primary = true;
  return null;
end;
$$;
create trigger opportunities_sync_primary_category after insert or update of opportunity_type on public.opportunities
  for each row execute function public.sync_primary_category();

-- The primary link can only change by changing opportunities.opportunity_type.
create function public.protect_primary_category() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_primary and exists (select 1 from public.opportunities o where o.id = old.opportunity_id and o.opportunity_type = old.category_code) then
      raise exception 'the primary category of opportunity % cannot be removed; change opportunity_type instead', old.opportunity_id
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  -- UPDATE: is_primary may not be flipped by hand.
  if new.is_primary is distinct from old.is_primary and pg_trigger_depth() = 1 then
    raise exception 'is_primary is managed by the opportunity_type column' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger opportunity_categories_protect_primary before update or delete on public.opportunity_categories
  for each row execute function public.protect_primary_category();
