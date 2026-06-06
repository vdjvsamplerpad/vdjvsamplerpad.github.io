begin;

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
      'grant execute on function %s to public, anon, authenticated',
      target_function.function_signature
    );
  end loop;
end $$;

commit;
