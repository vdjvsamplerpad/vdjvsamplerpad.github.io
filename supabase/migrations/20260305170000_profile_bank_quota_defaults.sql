alter table public.profiles
  add column if not exists owned_bank_quota integer;

alter table public.profiles
  add column if not exists owned_bank_pad_cap integer;

alter table public.profiles
  add column if not exists device_total_bank_cap integer;

update public.profiles
set
  owned_bank_quota = coalesce(owned_bank_quota, 6),
  owned_bank_pad_cap = coalesce(owned_bank_pad_cap, 64),
  device_total_bank_cap = coalesce(device_total_bank_cap, 120);

alter table public.profiles
  alter column owned_bank_quota set default 6;

alter table public.profiles
  alter column owned_bank_pad_cap set default 64;

alter table public.profiles
  alter column device_total_bank_cap set default 120;

alter table public.profiles
  alter column owned_bank_quota set not null;

alter table public.profiles
  alter column owned_bank_pad_cap set not null;

alter table public.profiles
  alter column device_total_bank_cap set not null;

alter table public.profiles
  drop constraint if exists profiles_owned_bank_quota_ck;

alter table public.profiles
  add constraint profiles_owned_bank_quota_ck
  check (owned_bank_quota between 1 and 500);

alter table public.profiles
  drop constraint if exists profiles_owned_bank_pad_cap_ck;

alter table public.profiles
  add constraint profiles_owned_bank_pad_cap_ck
  check (owned_bank_pad_cap between 1 and 256);

alter table public.profiles
  drop constraint if exists profiles_device_total_bank_cap_ck;

alter table public.profiles
  add constraint profiles_device_total_bank_cap_ck
  check (device_total_bank_cap between 10 and 1000);
