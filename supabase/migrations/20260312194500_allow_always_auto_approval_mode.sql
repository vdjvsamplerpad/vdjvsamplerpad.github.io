begin;

alter table public.store_payment_settings
  drop constraint if exists store_payment_settings_account_auto_approve_mode_ck,
  drop constraint if exists store_payment_settings_store_auto_approve_mode_ck;

alter table public.store_payment_settings
  add constraint store_payment_settings_account_auto_approve_mode_ck
  check (
    account_auto_approve_mode is null
    or account_auto_approve_mode in ('schedule', 'countdown', 'always')
  );

alter table public.store_payment_settings
  add constraint store_payment_settings_store_auto_approve_mode_ck
  check (
    store_auto_approve_mode is null
    or store_auto_approve_mode in ('schedule', 'countdown', 'always')
  );

commit;
