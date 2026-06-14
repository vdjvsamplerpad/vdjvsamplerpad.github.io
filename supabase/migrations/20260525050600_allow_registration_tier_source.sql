begin;

alter table public.profiles
  drop constraint if exists profiles_tier_source_ck;

alter table public.profiles
  add constraint profiles_tier_source_ck
  check (tier_source in (
    'signup',
    'registration',
    'migration_legacy',
    'admin',
    'upgrade_request',
    'voucher',
    'system'
  ));

commit;
