-- Migration 11/11: administration — roles, admin-only write access, admin functions, audit log.
--
-- Security model:
--  * WHO is an admin is data: public.user_roles. A user can read THEIR OWN role row and nothing
--    else; nobody but service_role (the operator, via SQL) can insert, change or delete roles.
--    So no regular user — and no admin — can grant privileges through the API. (There is no
--    profile "role" column a user could update.)
--  * Every admin write is an RLS policy `to authenticated … public.is_admin()`. Regular users keep
--    their SELECT-only access to the public catalogue; anon has nothing new.
--  * Column-level grants: `authenticated` can write only the editable columns. Identity columns
--    (created_by / verified_by …) are writable but never readable, and a trigger stops an admin
--    from stamping somebody else as the verifier.
--  * The admin functions are SECURITY INVOKER (no privilege escalation anywhere): they run with
--    the caller's own rights, so RLS applies inside them, and they exist because several tables
--    must change in ONE transaction (the original translation is a deferred invariant).
--  * Every admin function appends to an append-only audit log (who, what, which record — no content).

-- ── roles ───────────────────────────────────────────────────────────────────────────────────
create type public.app_role as enum ('admin');

create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.user_roles is 'Who is an admin. Readable by the user themself only; written only by service_role (operator SQL). No API path can grant a role.';

alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
create policy user_roles_select_own on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));
-- Deliberately NO insert/update/delete policy and no such privilege for anon/authenticated.

-- Runs as the caller: the sub-select sees only the caller's own role row (RLS above), which is exactly what is needed.
create function public.is_admin() returns boolean
language sql stable
set search_path = public
as $$
  select exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ── audit log (append-only) ─────────────────────────────────────────────────────────────────
create table public.admin_audit_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid not null,
  action    text not null check (action ~ '^[a-z_.]+$' and length(action) <= 60),
  entity    text not null check (entity ~ '^[a-z_]+$'),
  entity_id uuid,
  detail    text check (detail is null or length(detail) <= 200),
  at        timestamptz not null default now()
);
create index admin_audit_log_entity_idx on public.admin_audit_log (entity, entity_id, at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
grant insert (actor_id, action, entity, entity_id, detail) on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;
create policy audit_admin_select on public.admin_audit_log for select to authenticated using ((select public.is_admin()));
create policy audit_admin_insert on public.admin_audit_log for insert to authenticated
  with check ((select public.is_admin()) and actor_id = (select auth.uid()));
-- No UPDATE/DELETE privilege or policy: the log cannot be edited through the API.

-- ── admin write access to the catalogue ─────────────────────────────────────────────────────
-- Admins also READ everything (drafts, rejected, machine-draft translations, organizations without public records).
create policy opportunities_admin_select on public.opportunities for select to authenticated using ((select public.is_admin()));
create policy opportunities_admin_insert on public.opportunities for insert to authenticated
  with check ((select public.is_admin()) and (created_by is null or created_by = (select auth.uid())) and not is_demo);
create policy opportunities_admin_update on public.opportunities for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()) and not is_demo);
create policy opportunities_admin_delete on public.opportunities for delete to authenticated using ((select public.is_admin()));

create policy translations_admin_select on public.opportunity_translations for select to authenticated using ((select public.is_admin()));
create policy translations_admin_insert on public.opportunity_translations for insert to authenticated with check ((select public.is_admin()));
create policy translations_admin_update on public.opportunity_translations for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy translations_admin_delete on public.opportunity_translations for delete to authenticated using ((select public.is_admin()));

create policy organizations_admin_select on public.organizations for select to authenticated using ((select public.is_admin()));
create policy organizations_admin_insert on public.organizations for insert to authenticated with check ((select public.is_admin()) and not is_demo);
create policy organizations_admin_update on public.organizations for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()) and not is_demo);
create policy organizations_admin_delete on public.organizations for delete to authenticated using ((select public.is_admin()));

-- Category links are maintained by a trigger (primary link); it runs with the admin's rights.
create policy opportunity_categories_admin_select on public.opportunity_categories for select to authenticated using ((select public.is_admin()));
create policy opportunity_categories_admin_insert on public.opportunity_categories for insert to authenticated with check ((select public.is_admin()));
create policy opportunity_categories_admin_update on public.opportunity_categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy opportunity_categories_admin_delete on public.opportunity_categories for delete to authenticated using ((select public.is_admin()));

-- Privileges (RLS above decides WHO; these decide WHICH columns).
grant insert (slug, organization_id, opportunity_type, other_type_label, location_type, country, city_id, city_text,
              education_levels, eligible_fields, eligible_countries, funding_type, funding_amount, funding_currency, funding_period,
              funding_percent, participation_fee_amount, participation_fee_currency, application_url, official_source_url,
              application_start_date, application_deadline, deadline_type, deadline_timezone, original_language, featured, created_by)
  on public.opportunities to authenticated;
grant update (slug, organization_id, opportunity_type, other_type_label, location_type, country, city_id, city_text,
              education_levels, eligible_fields, eligible_countries, funding_type, funding_amount, funding_currency, funding_period,
              funding_percent, participation_fee_amount, participation_fee_currency, application_url, official_source_url,
              application_start_date, application_deadline, deadline_type, deadline_timezone, featured,
              publication_status, verification_status, verified_by, last_verified_at, content_version)
  on public.opportunities to authenticated;
grant delete on public.opportunities to authenticated;

grant insert (opportunity_id, language, title, short_description, description, requirements, benefits, eligibility, status, translated_from, source_version, translated_by)
  on public.opportunity_translations to authenticated;
grant update (title, short_description, description, requirements, benefits, eligibility, status, source_version, translated_by, reviewed_by, reviewed_at)
  on public.opportunity_translations to authenticated;
grant delete on public.opportunity_translations to authenticated;

grant insert (slug, kind, name, country, website_url, logo_path, verified_at) on public.organizations to authenticated;
grant update (slug, kind, name, country, website_url, logo_path, verified_at) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;

grant insert (opportunity_id, category_code, is_primary), update (is_primary), delete on public.opportunity_categories to authenticated;

-- An admin may stamp only THEMSELVES as the verifier (or clear it).
create function public.guard_verifier() returns trigger
language plpgsql
as $$
begin
  if new.verified_by is distinct from old.verified_by and new.verified_by is not null and new.verified_by <> (select auth.uid()) then
    raise exception 'verified_by must be the acting admin' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger opportunities_guard_verifier before update of verified_by on public.opportunities
  for each row execute function public.guard_verifier();

-- Publishing needs an EXPLICIT deadline statement (a date, or "rolling"): "unknown" is not enough. Demo records are exempt.
alter table public.opportunities add constraint opportunities_published_deadline
  check (publication_status <> 'published' or is_demo or deadline_type <> 'unknown');

-- ── admin functions (SECURITY INVOKER) ──────────────────────────────────────────────────────
create function public.admin_audit(p_action text, p_entity text, p_entity_id uuid, p_detail text default null) returns void
language sql
set search_path = public
as $$
  insert into public.admin_audit_log (actor_id, action, entity, entity_id, detail) values ((select auth.uid()), p_action, p_entity, p_entity_id, p_detail)
$$;

create function public.admin_require() returns void
language plpgsql stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
end;
$$;

-- Create or update an opportunity AND its translations in one transaction.
-- Payload: the editable opportunity columns (snake_case), plus
--   "translations": [{language, title, short_description, description, requirements, benefits, eligibility, status}]
--   "remove_languages": ["ru"]            (never the original)
-- On create the status is always draft and the record is unverified; status and verification have their own functions.
create function public.admin_save_opportunity(p_payload jsonb) returns uuid
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
      deadline_type, deadline_timezone, original_language, featured, created_by
    ) values (
      r.slug, r.organization_id, r.opportunity_type, r.other_type_label, r.location_type, r.country, r.city_id, r.city_text,
      coalesce(r.education_levels, '{}'), coalesce(r.eligible_fields, '{}'), r.eligible_countries, coalesce(r.funding_type, 'not_specified'),
      r.funding_amount, r.funding_currency, r.funding_period, r.funding_percent,
      r.participation_fee_amount, r.participation_fee_currency, r.application_url, r.official_source_url, r.application_start_date, r.application_deadline,
      coalesce(r.deadline_type, 'unknown'), coalesce(r.deadline_timezone, 'Asia/Baku'), r.original_language, coalesce(r.featured, false), (select auth.uid())
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

create function public.admin_set_publication_status(p_id uuid, p_status text) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  update public.opportunities set publication_status = p_status::public.publication_status where id = p_id;
  if not found then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('opportunity.status', 'opportunity', p_id, p_status);
end;
$$;

create function public.admin_set_verification(p_id uuid, p_verified boolean) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  if p_verified then
    update public.opportunities set verification_status = 'verified', verified_by = (select auth.uid()), last_verified_at = now() where id = p_id;
  else
    update public.opportunities set verification_status = 'unverified', verified_by = null, last_verified_at = null where id = p_id;
  end if;
  if not found then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('opportunity.verify', 'opportunity', p_id, case when p_verified then 'verified' else 'unverified' end);
end;
$$;

-- Review one translation: approve a machine draft for publication, send it back to draft, or mark it human-reviewed.
create function public.admin_review_translation(p_id uuid, p_language text, p_status text) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  if p_status not in ('human', 'machine_draft', 'machine_approved') then
    raise exception 'unsupported translation status' using errcode = '22023';
  end if;
  update public.opportunity_translations
     set status = p_status::public.translation_status, reviewed_by = (select auth.uid()), reviewed_at = now()
   where opportunity_id = p_id and language = p_language and status <> 'original';
  if not found then
    raise exception 'translation not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('translation.review', 'opportunity', p_id, p_language || ':' || p_status);
end;
$$;

create function public.admin_delete_opportunity(p_id uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  if exists (select 1 from public.opportunities where id = p_id and publication_status = 'published') then
    raise exception 'archive a published opportunity before deleting it' using errcode = '23514';
  end if;
  delete from public.opportunities where id = p_id;
  if not found then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('opportunity.delete', 'opportunity', p_id);
end;
$$;

create function public.admin_save_organization(p_payload jsonb) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  r public.organizations;
begin
  perform public.admin_require();
  r := jsonb_populate_record(null::public.organizations, p_payload - 'id');
  if v_id is null then
    insert into public.organizations (slug, kind, name, country, website_url, logo_path, verified_at)
    values (r.slug, r.kind, r.name, r.country, r.website_url, r.logo_path, r.verified_at) returning id into v_id;
  else
    update public.organizations o set
      slug = case when p_payload ? 'slug' then r.slug else o.slug end,
      kind = case when p_payload ? 'kind' then r.kind else o.kind end,
      name = case when p_payload ? 'name' then r.name else o.name end,
      country = case when p_payload ? 'country' then r.country else o.country end,
      website_url = case when p_payload ? 'website_url' then r.website_url else o.website_url end,
      verified_at = case when p_payload ? 'verified_at' then r.verified_at else o.verified_at end
    where o.id = v_id;
    if not found then
      raise exception 'organization not found' using errcode = 'P0002';
    end if;
  end if;
  perform public.admin_audit('organization.save', 'organization', v_id);
  return v_id;
end;
$$;

create function public.admin_delete_organization(p_id uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.admin_require();
  delete from public.organizations where id = p_id;   -- the foreign key refuses while opportunities use it
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  perform public.admin_audit('organization.delete', 'organization', p_id);
end;
$$;

-- One page of the admin list: ids + total, filtered and ordered in the database.
--   filters: {status, verification, expired (bool), organization_id, q}
create function public.admin_list_opportunities(p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20, p_now timestamptz default now())
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

-- Dashboard counters (one round trip).
create function public.admin_dashboard_stats(p_now timestamptz default now()) returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select jsonb_build_object(
    'total', count(*),
    'by_status', coalesce((select jsonb_object_agg(s, c) from (select publication_status::text as s, count(*) as c from public.opportunities group by 1) x), '{}'::jsonb),
    'unverified', count(*) filter (where verification_status <> 'verified'),
    'expired', count(*) filter (where verification_status = 'expired' or (deadline_type = 'fixed' and application_deadline < p_now)),
    'missing_translations', count(*) filter (where (
        select count(distinct t.language) from public.opportunity_translations t
         where t.opportunity_id = o.id and t.language in ('az', 'ru', 'en') and t.status <> 'machine_draft') < 3),
    'organizations', (select count(*) from public.organizations)
  ) into v_result from public.opportunities o;
  return v_result;
end;
$$;

-- Execution: signed-in users only (the functions refuse non-admins themselves; anon cannot even call them).
revoke all on function public.admin_audit(text, text, uuid, text), public.admin_require(),
  public.admin_save_opportunity(jsonb), public.admin_set_publication_status(uuid, text), public.admin_set_verification(uuid, boolean),
  public.admin_review_translation(uuid, text, text), public.admin_delete_opportunity(uuid), public.admin_save_organization(jsonb),
  public.admin_delete_organization(uuid), public.admin_list_opportunities(jsonb, integer, integer, timestamptz), public.admin_dashboard_stats(timestamptz)
  from public, anon;
grant execute on function public.admin_audit(text, text, uuid, text), public.admin_require(),
  public.admin_save_opportunity(jsonb), public.admin_set_publication_status(uuid, text), public.admin_set_verification(uuid, boolean),
  public.admin_review_translation(uuid, text, text), public.admin_delete_opportunity(uuid), public.admin_save_organization(jsonb),
  public.admin_delete_organization(uuid), public.admin_list_opportunities(jsonb, integer, integer, timestamptz), public.admin_dashboard_stats(timestamptz)
  to authenticated, service_role;
