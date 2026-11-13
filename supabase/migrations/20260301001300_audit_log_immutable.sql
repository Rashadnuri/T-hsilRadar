-- Migration 13: make the admin audit log genuinely append-only (QA audit finding).
--
-- Migration 11 gave `authenticated` select + insert only, which already made the log append-only for
-- every API user. It granted ALL to `service_role`, though, so a leaked or misused server key could
-- have rewritten history. Two layers close that:
--   1. privileges: nobody but the table owner can update, delete or truncate;
--   2. a trigger that refuses UPDATE / DELETE / TRUNCATE whoever asks (it can only be bypassed by
--      the database owner deliberately dropping or disabling it, which is an operator action).
-- The function is SECURITY INVOKER (the project rule: no SECURITY DEFINER anywhere).

revoke update, delete, truncate on public.admin_audit_log from service_role;

create function public.admin_audit_log_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger admin_audit_log_no_update_delete
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_immutable();

create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_immutable();

revoke all on function public.admin_audit_log_immutable() from public, anon, authenticated;
