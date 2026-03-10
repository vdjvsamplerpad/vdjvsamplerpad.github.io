begin;

alter table public.store_payment_settings
  add column if not exists account_auto_approve_mode text,
  add column if not exists account_auto_approve_duration_hours integer,
  add column if not exists account_auto_approve_expires_at timestamp with time zone,
  add column if not exists store_auto_approve_mode text,
  add column if not exists store_auto_approve_duration_hours integer,
  add column if not exists store_auto_approve_expires_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_payment_settings_account_auto_approve_mode_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_account_auto_approve_mode_ck
      check (
        account_auto_approve_mode is null
        or account_auto_approve_mode in ('schedule', 'countdown')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_payment_settings_store_auto_approve_mode_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_store_auto_approve_mode_ck
      check (
        store_auto_approve_mode is null
        or store_auto_approve_mode in ('schedule', 'countdown')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_payment_settings_account_auto_approve_duration_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_account_auto_approve_duration_ck
      check (
        account_auto_approve_duration_hours is null
        or (account_auto_approve_duration_hours >= 1 and account_auto_approve_duration_hours <= 168)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'store_payment_settings_store_auto_approve_duration_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_store_auto_approve_duration_ck
      check (
        store_auto_approve_duration_hours is null
        or (store_auto_approve_duration_hours >= 1 and store_auto_approve_duration_hours <= 168)
      );
  end if;
end;
$$;

update public.store_payment_settings
set
  account_auto_approve_mode = coalesce(account_auto_approve_mode, 'schedule'),
  account_auto_approve_duration_hours = coalesce(account_auto_approve_duration_hours, 24),
  store_auto_approve_mode = coalesce(store_auto_approve_mode, 'schedule'),
  store_auto_approve_duration_hours = coalesce(store_auto_approve_duration_hours, 24)
where true;

commit;
