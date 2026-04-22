begin;

alter table public.profiles
  add column if not exists welcome_email_sent_at timestamp with time zone;

update public.profiles
set
  owned_bank_quota = 2,
  owned_bank_pad_cap = 25,
  device_total_bank_cap = 4
where account_tier = 'free'
  and tier_source = 'signup';

commit;
