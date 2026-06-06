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
        'cleanup_activity_data',
        'copy_next_account_voucher_code'
      ])
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      target_function.function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      target_function.function_signature
    );
  end loop;
end $$;

commit;
