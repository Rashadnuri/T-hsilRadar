-- Migration 6/7: catalogue search, filtering, sorting and facets, in the database.
--
-- These are the SQL twins of src/lib/opportunities/search.ts and must keep the same meaning
-- (a parity test runs both against the same data):
--  * All filters combine with AND.
--  * Expired opportunities are returned only when the caller explicitly asks for them
--    (deadline = 'expired' or verification = 'expired').
--  * Filtering by level / field / country matches only what the source STATES.
--  * Search matches title, organization, keywords and description, folded for case/diacritics.
--
-- All functions are SECURITY INVOKER: row level security applies, so callers only ever see
-- opportunities they are allowed to read. Never SECURITY DEFINER here.
--
-- Input (p_filters jsonb) — keys, all optional:
--   type, scope, country, city, level, field, funding, location, deadline, verification,
--   featured (boolean), scope_exact (boolean: scope must match exactly, "both" excluded), exclude_demo (boolean),
--   sort ('relevance'|'deadline'|'newest'|'updated'),
--   tokens: [{ txt, types[], locations[], fundings[], levels[], fields[], cities[], countries[] }]
--     — the folded search words; the arrays list the codes whose label (in ANY language)
--       contains the word, resolved by the app from the translation dictionaries ("keywords").

create function public.opportunity_search_rows(p_filters jsonb default '{}'::jsonb, p_now timestamptz default now())
returns table (
  id uuid,
  scope text,
  state text,
  country text,
  city_id text,
  relevance integer,
  sort_k1 double precision,
  sort_k2 double precision,
  sort_k3 double precision,
  ok_type boolean, ok_scope boolean, ok_country boolean, ok_city boolean, ok_level boolean, ok_field boolean,
  ok_funding boolean, ok_location boolean, ok_deadline boolean, ok_verification boolean, ok_featured boolean,
  ok_demo boolean, ok_expiry boolean, ok_q boolean
)
language sql stable rows 100
-- jit = off: the planner over-estimates this query's cost and PostgreSQL's JIT compiler then spends
-- ~2 s per call (measured) to speed up a query that runs in a few ms.
set search_path = public, extensions
set jit = off
as $$
  with f as (
    select
      nullif(p_filters ->> 'type', '')         as f_type,
      nullif(p_filters ->> 'scope', '')        as f_scope,
      nullif(p_filters ->> 'country', '')      as f_country,
      nullif(p_filters ->> 'city', '')         as f_city,
      nullif(p_filters ->> 'level', '')        as f_level,
      nullif(p_filters ->> 'field', '')        as f_field,
      nullif(p_filters ->> 'funding', '')      as f_funding,
      nullif(p_filters ->> 'location', '')     as f_location,
      nullif(p_filters ->> 'deadline', '')     as f_deadline,
      nullif(p_filters ->> 'verification', '') as f_verification,
      coalesce((p_filters ->> 'featured')::boolean, false) as f_featured,
      coalesce((p_filters ->> 'scope_exact')::boolean, false) as f_scope_exact,
      coalesce((p_filters ->> 'exclude_demo')::boolean, false) as f_exclude_demo,
      coalesce(nullif(p_filters ->> 'sort', ''), 'deadline') as f_sort
  ),
  tk as (
    select t.txt,
           coalesce(t.types, '{}') as types, coalesce(t.locations, '{}') as locations, coalesce(t.fundings, '{}') as fundings,
           coalesce(t.levels, '{}') as levels, coalesce(t.fields, '{}') as fields, coalesce(t.cities, '{}') as cities,
           coalesce(t.countries, '{}') as countries
    from jsonb_to_recordset(coalesce(p_filters -> 'tokens', '[]'::jsonb))
      as t(txt text, types text[], locations text[], fundings text[], levels text[], fields text[], cities text[], countries text[])
  ),
  -- Searchable text per opportunity: only PUBLIC translations (never unreviewed machine drafts).
  docs as (
    select o.id,
           coalesce(string_agg(public.fold_text(tr.title), ' ') filter (where tr.status <> 'machine_draft'), '') as title_doc,
           coalesce(string_agg(public.fold_text(coalesce(tr.short_description, '') || ' ' || coalesce(tr.description, '')), ' ')
                    filter (where tr.status <> 'machine_draft'), '') as desc_doc
    from public.opportunities o
    left join public.opportunity_translations tr on tr.opportunity_id = o.id
    group by o.id
  ),
  base as (
    select
      o.id, o.opportunity_type, o.location_type, o.country, o.city_id, o.city_text, o.other_type_label,
      o.education_levels, o.eligible_fields, o.eligible_countries, o.funding_type, o.featured, o.is_demo,
      o.application_start_date, o.application_deadline, o.deadline_type, o.verification_status,
      coalesce(o.published_at, o.created_at) as published_ts, o.updated_at,
      org.name as org_name, d.title_doc, d.desc_doc,
      -- Application state, derived from timestamps and p_now on every call (never stored).
      case
        when o.verification_status = 'expired'
          or (o.deadline_type = 'fixed' and o.application_deadline is not null and o.application_deadline < p_now) then 'expired'
        when o.application_start_date is not null and o.application_start_date > p_now then 'upcoming'
        when o.deadline_type = 'rolling' then 'rolling'
        when o.deadline_type = 'unknown' or o.application_deadline is null then 'deadline_unknown'
        else 'open'
      end as state,
      -- Market scope, derived (SQL twin of deriveMarketScope).
      case
        when o.country is not null then case when o.country = 'AZ' then 'azerbaijan' else 'international' end
        when o.eligible_countries is null then 'both'
        when not exists (select 1 from unnest(o.eligible_countries) c where c <> 'AZ') then 'azerbaijan'
        when 'AZ' = any (o.eligible_countries) then 'both'
        else 'international'
      end as scope,
      case when o.deadline_type = 'fixed' and o.application_deadline is not null
           then ceil(extract(epoch from (o.application_deadline - p_now)) / 86400.0) end as days
    from public.opportunities o
    join public.organizations org on org.id = o.organization_id
    join docs d on d.id = o.id
  ),
  scored as (
    select
      b.*,
      -- Relevance: NULL when some search word matches nowhere. Weights: title 4 > organization 3 > keywords 2 > description 1.
      case when not exists (select 1 from tk) then 0 else (
        select case when bool_and(w.score > 0) then sum(w.score)::integer end
        from (
          select
            (case when strpos(b.title_doc, tk.txt) > 0 then 4 else 0 end)
            + (case when strpos(public.fold_text(b.org_name), tk.txt) > 0 then 3 else 0 end)
            + (case when
                 exists (select 1 from public.opportunity_categories oc where oc.opportunity_id = b.id and oc.category_code = any (tk.types))
                 or b.location_type::text = any (tk.locations)
                 or b.funding_type::text = any (tk.fundings)
                 or b.education_levels::text[] && tk.levels
                 or b.eligible_fields::text[] && tk.fields
                 or b.city_id = any (tk.cities)
                 or b.country = any (tk.countries)
                 or strpos(public.fold_text(coalesce(b.city_text, '') || ' ' || coalesce(b.other_type_label, '') || ' ' || coalesce(b.country, '')), tk.txt) > 0
               then 2 else 0 end)
            + (case when strpos(b.desc_doc, tk.txt) > 0 then 1 else 0 end) as score
          from tk
        ) w
      ) end as rel,
      -- Deadline ordering groups: 0 upcoming deadlines, 1 no deadline, 2 ended.
      case when b.state = 'expired' then 2 when b.deadline_type = 'fixed' and b.application_deadline is not null then 0 else 1 end as dl_group,
      case when b.application_deadline is null then 0
           when b.state = 'expired' then -extract(epoch from b.application_deadline)::double precision
           else extract(epoch from b.application_deadline)::double precision end as dl_key
    from base b
  )
  select
    s.id, s.scope, s.state, s.country, s.city_id,
    coalesce(s.rel, 0) as relevance,
    case f.f_sort when 'newest' then -extract(epoch from s.published_ts)::double precision
                  when 'updated' then -extract(epoch from s.updated_at)::double precision
                  when 'relevance' then -coalesce(s.rel, 0)::double precision
                  else s.dl_group::double precision end as sort_k1,
    case f.f_sort when 'deadline' then s.dl_key
                  when 'relevance' then s.dl_group::double precision
                  else 0::double precision end as sort_k2,
    case f.f_sort when 'relevance' then s.dl_key else 0::double precision end as sort_k3,
    f.f_type is null or exists (select 1 from public.opportunity_categories oc where oc.opportunity_id = s.id and oc.category_code = f.f_type) as ok_type,
    f.f_scope is null or s.scope = f.f_scope or (not f.f_scope_exact and s.scope = 'both') as ok_scope,
    f.f_country is null or s.country = f.f_country as ok_country,
    f.f_city is null or s.city_id = f.f_city as ok_city,
    f.f_level is null or f.f_level = any (s.education_levels::text[]) as ok_level,
    f.f_field is null or f.f_field = any (s.eligible_fields::text[]) as ok_field,
    f.f_funding is null or s.funding_type::text = f.f_funding as ok_funding,
    f.f_location is null or s.location_type::text = f.f_location as ok_location,
    case
      when f.f_deadline is null then true
      when f.f_deadline = 'open' then s.state in ('open', 'rolling')   -- accepting applications (incl. closing soon)
      when f.f_deadline = 'week' then s.days is not null and s.days between 0 and 7
      when f.f_deadline = 'month' then s.days is not null and s.days between 0 and 30
      when f.f_deadline = 'rolling' then s.state = 'rolling'
      when f.f_deadline = 'expired' then s.state = 'expired'
      else true
    end as ok_deadline,
    case
      when f.f_verification is null then true
      -- "Expired" means ended: stored status or a passed deadline, whatever the trust history.
      when f.f_verification = 'expired' then s.state = 'expired'
      -- A verified record whose deadline passed is effectively expired.
      else (case when s.verification_status = 'verified' and s.deadline_type = 'fixed' and s.application_deadline < p_now
                 then 'expired' else s.verification_status::text end) = f.f_verification
    end as ok_verification,
    (not f.f_featured) or s.featured as ok_featured,
    (not f.f_exclude_demo) or not s.is_demo as ok_demo,
    -- Expired records are never listed as active: only on explicit request.
    (s.state <> 'expired') or f.f_deadline = 'expired' or f.f_verification = 'expired' as ok_expiry,
    (not exists (select 1 from tk)) or s.rel is not null as ok_q
  from scored s
  cross join f
$$;


-- ── Paged search ────────────────────────────────────────────────────────────────────────────
-- Returns the ids of one page, in order, with the total and the (clamped) page number.
-- Empty result set ⇒ no rows. The app then loads the rows for these ids.
create function public.search_opportunities(
  p_filters   jsonb default '{}'::jsonb,
  p_page      integer default 1,
  p_page_size integer default 6,
  p_now       timestamptz default now()
) returns table (id uuid, total_count bigint, page integer)
language sql stable rows 10
set search_path = public, extensions
set jit = off
as $$
  with matched as (
    select r.id, r.sort_k1, r.sort_k2, r.sort_k3
    from public.opportunity_search_rows(p_filters, p_now) r
    where r.ok_type and r.ok_scope and r.ok_country and r.ok_city and r.ok_level and r.ok_field and r.ok_funding
      and r.ok_location and r.ok_deadline and r.ok_verification and r.ok_featured and r.ok_demo and r.ok_expiry and r.ok_q
  ),
  numbered as (
    select m.id,
           count(*) over () as total_count,
           row_number() over (order by m.sort_k1, m.sort_k2, m.sort_k3, m.id) as rn
    from matched m
  ),
  sizing as (
    select greatest(least(coalesce(p_page_size, 6), 100), 1) as size
  ),
  paged as (
    select n.*, sz.size,
           least(greatest(coalesce(p_page, 1), 1), greatest(ceil(n.total_count::numeric / sz.size)::integer, 1)) as eff_page
    from numbered n cross join sizing sz
  )
  select p.id, p.total_count, p.eff_page
  from paged p
  where p.rn > (p.eff_page - 1) * p.size and p.rn <= p.eff_page * p.size
  order by p.rn
$$;

-- ── Facets: counts for the Azerbaijan / International tabs and the Azerbaijani cities ──────
-- Each facet honours every OTHER active filter (not its own dimension).
create function public.catalogue_facets(p_filters jsonb default '{}'::jsonb, p_now timestamptz default now())
returns jsonb
language sql stable
set search_path = public, extensions
set jit = off
as $$
  with r as (select * from public.opportunity_search_rows(p_filters, p_now)),
  for_scope as (
    select * from r
    where ok_type and ok_country and ok_city and ok_level and ok_field and ok_funding and ok_location
      and ok_deadline and ok_verification and ok_featured and ok_demo and ok_expiry and ok_q
  ),
  for_city as (
    select * from r
    where ok_type and ok_level and ok_field and ok_funding and ok_location
      and ok_deadline and ok_verification and ok_featured and ok_demo and ok_expiry and ok_q
  )
  select jsonb_build_object(
    'scope', jsonb_build_object(
      'all', (select count(*) from for_scope),
      'azerbaijan', (select count(*) from for_scope where scope in ('azerbaijan', 'both')),
      'international', (select count(*) from for_scope where scope in ('international', 'both'))
    ),
    'azerbaijaniCities', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'count', n.cnt) order by c.sort_order, c.id)
      from public.cities c
      join (select city_id, count(*) as cnt from for_city where city_id is not null group by city_id) n on n.city_id = c.id
      where c.country = 'AZ'
    ), '[]'::jsonb)
  )
$$;

-- ── Options for the country / city selects: only places that have visible opportunities ────
create function public.catalogue_filter_options(p_exclude_demo boolean default false) returns jsonb
language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(x.country order by x.country) from (select distinct o.country from public.opportunities o where o.country is not null and (not p_exclude_demo or not o.is_demo)) x), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'country', c.country) order by c.sort_order, c.id)
      from public.cities c
      where exists (select 1 from public.opportunities o where o.city_id = c.id and (not p_exclude_demo or not o.is_demo))
    ), '[]'::jsonb)
  )
$$;

-- ── Execution privileges: functions are PUBLIC-executable by default in Postgres; be explicit.
revoke all on function public.opportunity_search_rows(jsonb, timestamptz) from public;
revoke all on function public.search_opportunities(jsonb, integer, integer, timestamptz) from public;
revoke all on function public.catalogue_facets(jsonb, timestamptz) from public;
revoke all on function public.catalogue_filter_options(boolean) from public;
grant execute on function public.opportunity_search_rows(jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.search_opportunities(jsonb, integer, integer, timestamptz) to anon, authenticated, service_role;
grant execute on function public.catalogue_facets(jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.catalogue_filter_options(boolean) to anon, authenticated, service_role;
