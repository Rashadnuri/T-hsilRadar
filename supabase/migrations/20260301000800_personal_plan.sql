-- Migration 9/9: personal opportunity management ("my plan").
--
-- Two tables, both PRIVATE to the user who owns the row:
--   saved_opportunities  – a bookmark (user ↔ opportunity), at most one per pair;
--   applications         – the user's own tracking of an application: status + personal notes,
--                          at most one per (user, opportunity).
--
-- Security model (same as profiles):
--  * RLS on, deny by default. `authenticated` may touch only rows whose user_id = auth.uid();
--    `anon` has no privilege at all. Nothing public reads or joins these tables.
--  * Column-level grants: user_id / opportunity_id can be set on INSERT only, never changed.
--  * A row can only point at an opportunity the caller can SEE (published): the INSERT policy
--    sub-selects `opportunities` under the caller's own RLS, so private/draft ids cannot be
--    probed or saved. (Foreign keys alone would not do this: they are checked without RLS.)
--  * Notes are free text rendered escaped; no HTML filtering is needed, only a size cap.
--  * No SECURITY DEFINER: every function and trigger here runs as the caller.

create type public.application_status as enum
  ('interested', 'preparing', 'applied', 'interview', 'accepted', 'rejected', 'withdrawn');

-- ── saved_opportunities ─────────────────────────────────────────────────────────────────────
create table public.saved_opportunities (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  created_at     timestamptz not null default now(),
  -- Prevents duplicate saved records (and gives the repository an ON CONFLICT target).
  constraint saved_opportunities_unique unique (user_id, opportunity_id)
);
comment on table public.saved_opportunities is 'Private bookmarks. RLS: owner-only. One row per (user, opportunity).';

-- ── applications ────────────────────────────────────────────────────────────────────────────
create table public.applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  opportunity_id    uuid not null references public.opportunities (id) on delete cascade,
  status            public.application_status not null default 'interested',
  notes             text,
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint applications_unique unique (user_id, opportunity_id),
  constraint applications_notes check (notes is null or (btrim(notes) <> '' and length(notes) <= 5000))
);
comment on table public.applications is 'Private application tracking with personal notes. RLS: owner-only; notes are never exposed to anyone else.';
comment on column public.applications.notes is 'PRIVATE personal notes of the owner.';

create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();

create function public.touch_application_status() returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger applications_touch_status before update of status on public.applications
  for each row execute function public.touch_application_status();

-- A per-user cap keeps one account from filling the table (abuse / accidents).
create function public.enforce_plan_limit() returns trigger
language plpgsql
as $$
declare
  current_count integer;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into current_count using new.user_id;
  if current_count >= 500 then
    raise exception 'plan limit reached (500 per user)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger saved_opportunities_limit before insert on public.saved_opportunities
  for each row execute function public.enforce_plan_limit();
create trigger applications_limit before insert on public.applications
  for each row execute function public.enforce_plan_limit();

create index saved_opportunities_user_idx on public.saved_opportunities (user_id, created_at desc);
create index saved_opportunities_opportunity_idx on public.saved_opportunities (opportunity_id);
create index applications_user_idx on public.applications (user_id, status);
create index applications_opportunity_idx on public.applications (opportunity_id);

-- ── Row level security ──────────────────────────────────────────────────────────────────────
alter table public.saved_opportunities enable row level security;
alter table public.applications enable row level security;

revoke all on public.saved_opportunities, public.applications from anon, authenticated;

grant select, delete on public.saved_opportunities to authenticated;
grant insert (user_id, opportunity_id) on public.saved_opportunities to authenticated;

grant select, delete on public.applications to authenticated;
grant insert (user_id, opportunity_id, status, notes) on public.applications to authenticated;
grant update (status, notes) on public.applications to authenticated;

grant all on public.saved_opportunities, public.applications to service_role;

-- saved_opportunities
create policy saved_select_own on public.saved_opportunities
  for select to authenticated using (user_id = (select auth.uid()));
create policy saved_insert_own on public.saved_opportunities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.opportunities o where o.id = opportunity_id)   -- visible (public) opportunities only
  );
create policy saved_delete_own on public.saved_opportunities
  for delete to authenticated using (user_id = (select auth.uid()));

-- applications
create policy applications_select_own on public.applications
  for select to authenticated using (user_id = (select auth.uid()));
create policy applications_insert_own on public.applications
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.opportunities o where o.id = opportunity_id)
  );
create policy applications_update_own on public.applications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy applications_delete_own on public.applications
  for delete to authenticated using (user_id = (select auth.uid()));
