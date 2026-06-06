begin;

drop policy if exists auth_client_compatibility_attempts_deny_all on public.auth_client_compatibility_attempts;
create policy auth_client_compatibility_attempts_deny_all
on public.auth_client_compatibility_attempts
for all
using (false)
with check (false);

drop policy if exists client_crash_reports_deny_all on public.client_crash_reports;
create policy client_crash_reports_deny_all
on public.client_crash_reports
for all
using (false)
with check (false);

drop policy if exists installer_buy_products_deny_all on public.installer_buy_products;
create policy installer_buy_products_deny_all
on public.installer_buy_products
for all
using (false)
with check (false);

drop policy if exists installer_purchase_requests_deny_all on public.installer_purchase_requests;
create policy installer_purchase_requests_deny_all
on public.installer_purchase_requests
for all
using (false)
with check (false);

drop policy if exists installer_tier_configs_deny_all on public.installer_tier_configs;
create policy installer_tier_configs_deny_all
on public.installer_tier_configs
for all
using (false)
with check (false);

drop policy if exists "Public Access" on storage.objects;
drop policy if exists store_assets_select_public on storage.objects;

do $$
declare
  target_function record;
begin
  for target_function in
    select oid::regprocedure as function_signature
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = any (array[
        'claim_single_active_session',
        'cleanup_activity_data',
        'copy_next_account_voucher_code',
        'ensure_profile_for_auth_user',
        'finalize_signout_session',
        'is_admin',
        'mark_session_offline',
        'upsert_active_session',
        'validate_single_session'
      ])
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      target_function.function_signature
    );
  end loop;
end $$;

do $$
declare
  target_function record;
begin
  for target_function in
    select oid::regprocedure as function_signature
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = any (array[
        'claim_single_active_session',
        'cleanup_activity_data',
        'copy_next_account_voucher_code',
        'finalize_signout_session',
        'mark_session_offline',
        'upsert_active_session',
        'validate_single_session'
      ])
  loop
    execute format(
      'grant execute on function %s to service_role',
      target_function.function_signature
    );
  end loop;
end $$;

commit;
