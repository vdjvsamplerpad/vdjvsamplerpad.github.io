begin;

alter table public.store_payment_settings
  add column if not exists account_price_php numeric(12,2);

alter table public.account_registration_requests
  add column if not exists account_price_php_snapshot numeric(12,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_account_price_php_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_account_price_php_ck
      check (account_price_php is null or account_price_php >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_registration_requests_account_price_php_snapshot_ck'
  ) then
    alter table public.account_registration_requests
      add constraint account_registration_requests_account_price_php_snapshot_ck
      check (account_price_php_snapshot is null or account_price_php_snapshot >= 0);
  end if;
end;
$$;

create index if not exists idx_account_registration_requests_created_at
  on public.account_registration_requests (created_at desc);

commit;