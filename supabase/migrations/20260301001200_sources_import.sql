-- Migration 13/13: opportunity sources, imports and data-quality functions.
--
--  * opportunity_sources: WHERE information comes from (the organization's official site / API / authorized feed) and when it
--    was last checked by a person. Admin-only (RLS), like the rest of the admin area. NOTHING here fetches a website:
--    the platform never scrapes; a person checks the official page and records the date.
--  * opportunities.source_id / import_batch: provenance of imported records. Imported records are ALWAYS created as drafts.
--  * admin_duplicate_index / admin_import_batches / admin_expire_opportunities / admin_quality_report: SECURITY INVOKER helpers.

create type public.source_access_method as enum ('official_website', 'official_api', 'authorized_feed', 'manual');

create table public.opportunity_sources (
  id                uuid primary key default gen_random_uuid(),
  organization_name text not null check (btrim(organization_name) <> '' and length(organization_name) <= 200 and not public.has_raw_html(organization_name)),
  website_url       text not null check (website_url ~ '^https://[^\s/@]+\.[^\s/@]+(/[^\s]*)?$' and length(website_url) <= 500),
  -- The kind of organization the source belongs to (government, university, bank, IT company, NGO, scholarship organization…).
  source_type       public.organization_kind not null,
  country           text check (country is null or country ~ '^[A-Z]{2}$'),
  -- HOW the information is obtained: prefer official APIs and authorized feeds; "manual" = a person reads the official page.
  access_method     public.source_access_method not null default 'official_website',
  last_checked_at   timestamptz,
  is_active         boolean not null default true,
  notes             text check (notes is null or (length(notes) <= 2000 and not public.has_raw_html(notes))),
  organization_id   uuid references public.organizations (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint opportunity_sources_url_unique unique (website_url)
);
comment on table public.opportunity_sources is 'Official sources of opportunity data. Admin-only. last_checked_at is set by a person; the platform does not crawl.';
create index opportunity_sources_org_idx on public.opportunity_sources (organization_id) where organization_id is not null;
create index opportunity_sources_active_idx on public.opportunity_sources (is_active, last_checked_at);
create trigger opportunity_sources_set_updated_at before update on public.opportunity_sources
  for each row execute function public.set_updated_at();

alter table public.opportunity_sources enable row level security;
revoke all on public.opportunity_sources from anon, authenticated;
grant select, delete on public.opportunity_sources to authenticated;
grant insert (organization_name, website_url, source_type, country, access_method, last_checked_at, is_active, notes, organization_id) on public.opportunity_sources to authenticated;
grant update (organization_name, website_url, source_type, country, access_method, last_checked_at, is_active, notes, organization_id) on public.opportunity_sources to authenticated;
grant all on public.opportunity_sources to service_role;
create policy sources_admin_select on public.opportunity_sources for select to authenticated using ((select public.is_admin()));
create policy sources_admin_insert on public.opportunity_sources for insert to authenticated with check ((select public.is_admin()));
create policy sources_admin_update on public.opportunity_sources for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy sources_admin_delete on public.opportunity_sources for delete to authenticated using ((select public.is_admin()));

-- Provenance of imported records (internal; not part of the public column list).
alter table public.opportunities
  add column source_id uuid references public.opportunity_sources (id) on delete set null,
  add column import_batch text check (import_batch is null or import_batch ~ '^[a-z0-9][a-z0-9-]{3,60}$');
create index opportunities_source_idx on public.opportunities (source_id) where source_id is not null;
create index opportunities_import_batch_idx on public.opportunities (import_batch) where import_batch is not null;
grant select (source_id, import_batch) on public.opportunities to authenticated;
grant insert (source_id, import_batch) on public.opportunities to authenticated;
grant update (source_id) on public.opportunities to authenticated;

create or replace function public.admin_save_opportunity(p_payload jsonb) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  r public.opportunities;
  t jsonb;
  v_original text;
  v_version integer;
  v_pass integer;
  v_lang text;
begin
  perform public.admin_require();
  r := jsonb_populate_record(null::public.opportunities, p_payload - 'translations' - 'remove_languages' - 'id');

  if v_id is null then
    insert into public.opportunities (
      slug, organization_id, opportunity_type, other_type_label, location_type, country, city_id, city_text,
      education_levels, eligible_fields, eligible_countries, funding_type, funding_amount, funding_currency, funding_period, funding_percent,
      participation_fee_amount, participation_fee_currency, application_url, official_source_url, application_start_date, application_deadline,
      deadline_type, deadline_timezone, original_language, featured, created_by, source_id, import_batch
    ) values (
      r.slug, r.organization_id, r.opportunity_type, r.other_type_label, r.location_type, r.country, r.city_id, r.city_text,
      coalesce(r.education_levels, '{}'), coalesce(r.eligible_fields, '{}'), r.eligible_countries, coalesce(r.funding_type, 'not_specified'),
      r.funding_amount, r.funding_currency, r.funding_period, r.funding_percent,
      r.participation_fee_amount, r.participation_fee_currency, r.application_url, r.official_source_url, r.application_start_date, r.application_deadline,
      coalesce(r.deadline_type, 'unknown'), coalesce(r.deadline_timezone, 'Asia/Baku'), r.original_language, coalesce(r.featured, false), (select auth.uid()),
      r.source_id, r.import_batch
    ) returning id into v_id;
  else
    -- Only keys present in the payload change; status, verification and the original language never do here.
    update public.opportunities o set
      slug = case when p_payload ? 'slug' then r.slug else o.slug end,
      organization_id = case when p_payload ? 'organization_id' then r.organization_id else o.organization_id end,
      opportunity_type = case when p_payload ? 'opportunity_type' then r.opportunity_type else o.opportunity_type end,
      other_type_label = case when p_payload ? 'other_type_label' then r.other_type_label else o.other_type_label end,
      location_type = case when p_payload ? 'location_type' then r.location_type else o.location_type end,
      country = case when p_payload ? 'country' then r.country else o.country end,
      city_id = case when p_payload ? 'city_id' then r.city_id else o.city_id end,
      city_text = case when p_payload ? 'city_text' then r.city_text else o.city_text end,
      education_levels = case when p_payload ? 'education_levels' then coalesce(r.education_levels, '{}') else o.education_levels end,
      eligible_fields = case when p_payload ? 'eligible_fields' then coalesce(r.eligible_fields, '{}') else o.eligible_fields end,
      eligible_countries = case when p_payload ? 'eligible_countries' then r.eligible_countries else o.eligible_countries end,
      funding_type = case when p_payload ? 'funding_type' then coalesce(r.funding_type, 'not_specified') else o.funding_type end,
      funding_amount = case when p_payload ? 'funding_amount' then r.funding_amount else o.funding_amount end,
      funding_currency = case when p_payload ? 'funding_currency' then r.funding_currency else o.funding_currency end,
      funding_period = case when p_payload ? 'funding_period' then r.funding_period else o.funding_period end,
      funding_percent = case when p_payload ? 'funding_percent' then r.funding_percent else o.funding_percent end,
      participation_fee_amount = case when p_payload ? 'participation_fee_amount' then r.participation_fee_amount else o.participation_fee_amount end,
      participation_fee_currency = case when p_payload ? 'participation_fee_currency' then r.participation_fee_currency else o.participation_fee_currency end,
      application_url = case when p_payload ? 'application_url' then r.application_url else o.application_url end,
      official_source_url = case when p_payload ? 'official_source_url' then r.official_source_url else o.official_source_url end,
      application_start_date = case when p_payload ? 'application_start_date' then r.application_start_date else o.application_start_date end,
      application_deadline = case when p_payload ? 'application_deadline' then r.application_deadline else o.application_deadline end,
      deadline_type = case when p_payload ? 'deadline_type' then coalesce(r.deadline_type, 'unknown') else o.deadline_type end,
      deadline_timezone = case when p_payload ? 'deadline_timezone' then coalesce(r.deadline_timezone, 'Asia/Baku') else o.deadline_timezone end,
      featured = case when p_payload ? 'featured' then coalesce(r.featured, false) else o.featured end
    where o.id = v_id;
    if not found then
      raise exception 'opportunity not found' using errcode = 'P0002';
    end if;
  end if;

  select original_language into v_original from public.opportunities where id = v_id;

  -- Pass 1 writes the ORIGINAL (its edit may outdate the others); pass 2 the other languages.
  for v_pass in 1..2 loop
    for t in select * from jsonb_array_elements(coalesce(p_payload -> 'translations', '[]'::jsonb)) loop
      continue when (v_pass = 1) <> ((t ->> 'status') = 'original');
      select content_version into v_version from public.opportunities where id = v_id;
      insert into public.opportunity_translations (
        opportunity_id, language, title, short_description, description, requirements, benefits, eligibility, status, translated_from, source_version, translated_by
      ) values (
        v_id, t ->> 'language', t ->> 'title',
        nullif(t ->> 'short_description', ''), nullif(t ->> 'description', ''), nullif(t ->> 'requirements', ''), nullif(t ->> 'benefits', ''), nullif(t ->> 'eligibility', ''),
        (t ->> 'status')::public.translation_status,
        case when (t ->> 'status') = 'original' then null else v_original end,
        v_version, (select auth.uid())
      )
      on conflict (opportunity_id, language) do update set
        title = excluded.title, short_description = excluded.short_description, description = excluded.description,
        requirements = excluded.requirements, benefits = excluded.benefits, eligibility = excluded.eligibility,
        status = excluded.status, source_version = excluded.source_version, translated_by = (select auth.uid()),
        reviewed_by = null, reviewed_at = null;
    end loop;
  end loop;

  for v_lang in select jsonb_array_elements_text(coalesce(p_payload -> 'remove_languages', '[]'::jsonb)) loop
    delete from public.opportunity_translations where opportunity_id = v_id and language = v_lang and status <> 'original';
  end loop;

  perform public.admin_audit('opportunity.save', 'opportunity', v_id);
  return v_id;
end;
$$;

create or replace function public.admin_list_opportunities(p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20, p_now timestamptz default now())
returns table (id uuid, total_count bigint, page integer)
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_size integer := greatest(least(coalesce(p_page_size, 20), 100), 1);
  v_q text := nullif(btrim(coalesce(p_filters ->> 'q', '')), '');
begin
  perform public.admin_require();
  return query
  with matched as (
    select o.id, o.updated_at
      from public.opportunities o
     where (p_filters ->> 'status' is null or o.publication_status::text = p_filters ->> 'status')
       and (p_filters ->> 'verification' is null or o.verification_status::text = p_filters ->> 'verification')
       and (p_filters ->> 'organization_id' is null or o.organization_id::text = p_filters ->> 'organization_id')
       and (p_filters ->> 'batch' is null or o.import_batch = p_filters ->> 'batch')
       and (not coalesce((p_filters ->> 'imported')::boolean, false) or o.import_batch is not null)
       and (not coalesce((p_filters ->> 'expired')::boolean, false)
            or o.verification_status = 'expired' or (o.deadline_type = 'fixed' and o.application_deadline < p_now))
       and (v_q is null or o.slug ilike '%' || v_q || '%'
            or exists (select 1 from public.opportunity_translations t where t.opportunity_id = o.id and public.fold_text(t.title) like '%' || public.fold_text(v_q) || '%'))
  ), counted as (select count(*) as total from matched), pg as (
    select least(greatest(coalesce(p_page, 1), 1), greatest(ceil((select total from counted)::numeric / v_size)::integer, 1)) as cur_page
  )
  select m.id, (select total from counted), (select cur_page from pg)
    from matched m
   order by m.updated_at desc, m.id
  offset ((select cur_page from pg) - 1) * v_size limit v_size;
end;
$$;

-- ── sources ─────────────────────────────────────────────────────────────────────────────────
create function public.admin_save_source(p_payload jsonb) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  r public.opportunity_sources;
begin
  perform public.admin_require();
  r := jsonb_populate_record(null::public.opportunity_sources, p_payload - 'id');
  if v_id is null then
    insert into public.opportunity_sources (organization_name, website_url, source_type, country, access_method, last_checked_at, is_active, notes, organization_id)
    values (r.organization_name, r.website_url, r.source_type, r.country, coalesce(r.access_method, 'official_website'), r.last_checked_at, coalesce(r.is_active, true), r.notes, r.organization_id)
    returning id into v_id;
  else
    update public.opportunity_sources s set
      organization_name = case when p_payload ? 'organization_name' then r.organization_name else s.organization_name end,
      website_url = case when p_payload ? 'website_url' then r.website_url else s.website_url end,
      source_type = case when p_payload ? 'source_type' then r.source_type else s.source_type end,
      country = case when p_payload ? 'country' then r.country else s.country end,
      access_method = case when p_payload ? 'access_method' then coalesce(r.access_method, 'official_website') else s.access_method end,
      is_active = case when p_payload ? 'is_active' then coalesce(r.is_active, true) else s.is_active end,
      notes = case when p_payload ? 'notes' then r.notes else s.notes end,
      organization_id = case when p_payload ? 'organization_id' then r.organization_id else s.organization_id end
    where s.id = v_id;
    if not found then
      raise exception 'source not found' using errcode = 'P0002';
    end if;
  end if;
  perform public.admin_audit('source.save', 'source', v_id);
  return v_id;
end;
$$;

-- "I opened the official page and checked it": records the date (never set automatically).
create function public.admin_mark_source_checked(p_id uuid, p_at timestamptz default now()) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  update public.opportunity_sources set last_checked_at = least(coalesce(p_at, now()), now()) where id = p_id;
  if not found then
    raise exception 'source not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('source.checked', 'source', p_id);
end;
$$;

create function public.admin_delete_source(p_id uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  delete from public.opportunity_sources where id = p_id;
  if not found then
    raise exception 'source not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('source.delete', 'source', p_id);
end;
$$;

-- ── duplicate detection input: a compact index of every existing opportunity ───────────────
create function public.admin_duplicate_index() returns jsonb
language plpgsql stable
set search_path = public
as $$
begin
  perform public.admin_require();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'organization_id', o.organization_id, 'official_source_url', o.official_source_url,
      'application_deadline', o.application_deadline, 'status', o.publication_status,
      'titles', (select coalesce(jsonb_agg(t.title), '[]'::jsonb) from public.opportunity_translations t where t.opportunity_id = o.id)
    )), '[]'::jsonb)
    from (select id, slug, organization_id, official_source_url, application_deadline, publication_status from public.opportunities order by created_at desc limit 20000) o
  );
end;
$$;

-- ── import batches ──────────────────────────────────────────────────────────────────────────
create function public.admin_import_batches() returns jsonb
language plpgsql stable
set search_path = public
as $$
begin
  perform public.admin_require();
  return (
    select coalesce(jsonb_agg(b order by b ->> 'last_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'batch', import_batch, 'total', count(*),
        'draft', count(*) filter (where publication_status = 'draft'),
        'in_review', count(*) filter (where publication_status = 'in_review'),
        'published', count(*) filter (where publication_status = 'published'),
        'other', count(*) filter (where publication_status not in ('draft', 'in_review', 'published')),
        'last_at', max(created_at)) as b
      from public.opportunities where import_batch is not null group by import_batch limit 200
    ) x
  );
end;
$$;

-- ── expiry detection ────────────────────────────────────────────────────────────────────────
-- A VERIFIED opportunity whose fixed deadline has passed is flagged `expired`. A page that still exists proves nothing:
-- only the deadline (or a person) can end an opportunity, and a record is never assumed active.
create function public.admin_expire_opportunities(p_now timestamptz default now()) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  perform public.admin_require();
  update public.opportunities
     set verification_status = 'expired'
   where verification_status = 'verified' and deadline_type = 'fixed' and application_deadline < p_now;
  get diagnostics v_count = row_count;
  perform public.admin_audit('opportunity.expire_check', 'opportunity', null, v_count::text);
  return v_count;
end;
$$;

-- ── data-quality report ─────────────────────────────────────────────────────────────────────
create function public.admin_quality_report(p_now timestamptz default now(), p_stale_days integer default 90) returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_stale interval := make_interval(days => greatest(coalesce(p_stale_days, 90), 1));
begin
  perform public.admin_require();
  return jsonb_build_object(
    'expired_unflagged', (select coalesce(jsonb_agg(id order by application_deadline desc), '[]'::jsonb) from (
        select id, application_deadline from public.opportunities
         where verification_status = 'verified' and deadline_type = 'fixed' and application_deadline < p_now limit 100) a),
    'stale_verification', (select coalesce(jsonb_agg(id order by last_verified_at), '[]'::jsonb) from (
        select id, last_verified_at from public.opportunities
         where verification_status = 'verified' and last_verified_at < p_now - v_stale limit 100) b),
    'sources_overdue', (select coalesce(jsonb_agg(id order by last_checked_at nulls first), '[]'::jsonb) from (
        select id, last_checked_at from public.opportunity_sources
         where is_active and (last_checked_at is null or last_checked_at < p_now - v_stale) limit 100) c),
    'published_missing_translations', (select coalesce(jsonb_agg(id), '[]'::jsonb) from (
        select o.id from public.opportunities o
         where o.publication_status = 'published' and (
           select count(distinct t.language) from public.opportunity_translations t
            where t.opportunity_id = o.id and t.language in ('az', 'ru', 'en') and t.status <> 'machine_draft') < 3 limit 100) d)
  );
end;
$$;

revoke all on function public.admin_save_source(jsonb), public.admin_mark_source_checked(uuid, timestamptz), public.admin_delete_source(uuid),
  public.admin_duplicate_index(), public.admin_import_batches(), public.admin_expire_opportunities(timestamptz), public.admin_quality_report(timestamptz, integer)
  from public, anon;
grant execute on function public.admin_save_source(jsonb), public.admin_mark_source_checked(uuid, timestamptz), public.admin_delete_source(uuid),
  public.admin_duplicate_index(), public.admin_import_batches(), public.admin_expire_opportunities(timestamptz), public.admin_quality_report(timestamptz, integer)
  to authenticated, service_role;
