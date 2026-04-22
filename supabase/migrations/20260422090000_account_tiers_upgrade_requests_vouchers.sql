begin;

alter table public.profiles
  add column if not exists account_tier text not null default 'free',
  add column if not exists tier_updated_at timestamp with time zone not null default timezone('utc', now()),
  add column if not exists tier_source text not null default 'signup';

alter table public.profiles
  drop constraint if exists profiles_account_tier_ck;

alter table public.profiles
  add constraint profiles_account_tier_ck
  check (account_tier in ('free', 'pro', 'pro_max'));

alter table public.profiles
  drop constraint if exists profiles_tier_source_ck;

alter table public.profiles
  add constraint profiles_tier_source_ck
  check (tier_source in ('signup', 'migration_legacy', 'admin', 'upgrade_request', 'voucher', 'system'));

update public.profiles
set
  account_tier = case when role = 'admin' then 'pro_max' else 'pro' end,
  tier_source = 'migration_legacy',
  tier_updated_at = timezone('utc', now())
where tier_source = 'signup'
  and account_tier = 'free';

create table if not exists public.account_tier_configs (
  tier text primary key check (tier in ('free', 'pro', 'pro_max')),
  display_name text not null,
  description text,
  price_php numeric(12, 2) not null default 0 check (price_php >= 0),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

insert into public.account_tier_configs (tier, display_name, description, price_php, limits, features)
values
  (
    'free',
    'FREE',
    'Free account with default-bank trial and limited own-bank features.',
    0,
    '{"owned_bank_quota":2,"owned_bank_pad_cap":25,"device_total_bank_cap":4,"default_bank_daily_plays":100,"deck_count":2}'::jsonb,
    '{
      "bank_store_browse": true,
      "bank_store_checkout": false,
      "bank_store_download": false,
      "bank_store_free_claim": false,
      "bank_store_all_access": false,
      "search": false,
      "input_mapping": false,
      "system_shortcuts": false,
      "channel_shortcuts": false,
      "mapping_import_export": false,
      "backup_repair": false,
      "advanced_stop_modes": false,
      "mixer_hotcue": false,
      "pad_edit_group": false,
      "pad_edit_tempo": false,
      "pad_edit_keyboard_midi": false,
      "pad_edit_hotcue": false,
      "pad_edit_fades": false,
      "bank_edit_position": false,
      "bank_edit_keyboard_midi": false,
      "store_demo_banks": true,
      "own_bank_unlimited_play": true
    }'::jsonb
  ),
  (
    'pro',
    'PRO',
    'Current full VDJV feature set.',
    0,
    '{"owned_bank_quota":6,"owned_bank_pad_cap":64,"device_total_bank_cap":120,"default_bank_daily_plays":null,"deck_count":4}'::jsonb,
    '{
      "bank_store_browse": true,
      "bank_store_checkout": true,
      "bank_store_download": true,
      "bank_store_free_claim": true,
      "bank_store_all_access": false,
      "search": true,
      "input_mapping": true,
      "system_shortcuts": true,
      "channel_shortcuts": true,
      "mapping_import_export": true,
      "backup_repair": true,
      "advanced_stop_modes": true,
      "mixer_hotcue": true,
      "pad_edit_group": true,
      "pad_edit_tempo": true,
      "pad_edit_keyboard_midi": true,
      "pad_edit_hotcue": true,
      "pad_edit_fades": true,
      "bank_edit_position": true,
      "bank_edit_keyboard_midi": true,
      "store_demo_banks": true,
      "own_bank_unlimited_play": true
    }'::jsonb
  ),
  (
    'pro_max',
    'PRO MAX',
    'All PRO features plus all published store banks.',
    800,
    '{"owned_bank_quota":12,"owned_bank_pad_cap":128,"device_total_bank_cap":150,"default_bank_daily_plays":null,"deck_count":4}'::jsonb,
    '{
      "bank_store_browse": true,
      "bank_store_checkout": true,
      "bank_store_download": true,
      "bank_store_free_claim": true,
      "bank_store_all_access": true,
      "search": true,
      "input_mapping": true,
      "system_shortcuts": true,
      "channel_shortcuts": true,
      "mapping_import_export": true,
      "backup_repair": true,
      "advanced_stop_modes": true,
      "mixer_hotcue": true,
      "pad_edit_group": true,
      "pad_edit_tempo": true,
      "pad_edit_keyboard_midi": true,
      "pad_edit_hotcue": true,
      "pad_edit_fades": true,
      "bank_edit_position": true,
      "bank_edit_keyboard_midi": true,
      "store_demo_banks": true,
      "own_bank_unlimited_play": true
    }'::jsonb
  )
on conflict (tier) do nothing;

create table if not exists public.profile_feature_overrides (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

create table if not exists public.account_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text,
  target_tier text not null check (target_tier in ('pro', 'pro_max')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  payment_channel text check (payment_channel is null or payment_channel in ('image_proof', 'gcash_manual', 'maya_manual', 'voucher')),
  payer_name text,
  reference_no text,
  proof_path text,
  notes text,
  base_price_php_snapshot numeric(12, 2) not null default 0 check (base_price_php_snapshot >= 0),
  store_credit_php_snapshot numeric(12, 2) not null default 0 check (store_credit_php_snapshot >= 0),
  quote_price_php_snapshot numeric(12, 2) not null default 0 check (quote_price_php_snapshot >= 0),
  purchase_credit_snapshot jsonb not null default '[]'::jsonb,
  voucher_id uuid,
  receipt_reference text unique,
  rejection_message text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists idx_account_upgrade_requests_user_status
  on public.account_upgrade_requests (user_id, status, created_at desc);

create index if not exists idx_account_upgrade_requests_status_created
  on public.account_upgrade_requests (status, created_at desc);

create index if not exists idx_account_upgrade_requests_email
  on public.account_upgrade_requests (lower(email));

create table if not exists public.account_voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_tier text not null check (target_tier in ('pro', 'pro_max')),
  max_codes integer not null default 1 check (max_codes > 0 and max_codes <= 10000),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  expires_at timestamp with time zone,
  target_email text,
  target_user_id uuid references auth.users(id) on delete set null,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists idx_account_voucher_campaigns_active
  on public.account_voucher_campaigns (is_active, target_tier, expires_at);

create table if not exists public.account_vouchers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.account_voucher_campaigns(id) on delete cascade,
  code_hash text not null unique,
  code_prefix text,
  code_suffix text,
  target_tier text not null check (target_tier in ('pro', 'pro_max')),
  status text not null default 'reserved' check (status in ('reserved', 'redeemed', 'disabled', 'expired')),
  reserved_for_email text,
  reserved_for_user_id uuid references auth.users(id) on delete set null,
  copied_by uuid references auth.users(id) on delete set null,
  copied_at timestamp with time zone not null default timezone('utc', now()),
  expires_at timestamp with time zone,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists idx_account_vouchers_campaign_status
  on public.account_vouchers (campaign_id, status, created_at desc);

create index if not exists idx_account_vouchers_reserved_user
  on public.account_vouchers (reserved_for_user_id, status);

create table if not exists public.account_voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.account_vouchers(id) on delete cascade,
  campaign_id uuid not null references public.account_voucher_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  target_tier text not null check (target_tier in ('pro', 'pro_max')),
  redeemed_at timestamp with time zone not null default timezone('utc', now()),
  request_id uuid references public.account_upgrade_requests(id) on delete set null,
  unique (voucher_id)
);

alter table public.account_upgrade_requests
  drop constraint if exists account_upgrade_requests_voucher_id_fkey;

alter table public.account_upgrade_requests
  add constraint account_upgrade_requests_voucher_id_fkey
  foreign key (voucher_id) references public.account_vouchers(id) on delete set null;

create index if not exists idx_account_voucher_redemptions_user
  on public.account_voucher_redemptions (user_id, redeemed_at desc);

create or replace function public.copy_next_account_voucher_code(
  p_campaign_id uuid,
  p_code_hash text,
  p_code_prefix text,
  p_code_suffix text,
  p_admin_user_id uuid
)
returns public.account_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.account_voucher_campaigns;
  v_voucher public.account_vouchers;
begin
  select *
    into v_campaign
    from public.account_voucher_campaigns
    where id = p_campaign_id
    for update;

  if not found then
    raise exception 'VOUCHER_CAMPAIGN_NOT_FOUND';
  end if;

  if v_campaign.is_active is not true then
    raise exception 'CAMPAIGN_INACTIVE';
  end if;

  if v_campaign.expires_at is not null and v_campaign.expires_at <= timezone('utc', now()) then
    raise exception 'CAMPAIGN_EXPIRED';
  end if;

  if v_campaign.reserved_count >= v_campaign.max_codes then
    raise exception 'VOUCHER_LIMIT_REACHED';
  end if;

  insert into public.account_vouchers (
    campaign_id,
    code_hash,
    code_prefix,
    code_suffix,
    target_tier,
    status,
    reserved_for_email,
    reserved_for_user_id,
    copied_by,
    expires_at
  )
  values (
    v_campaign.id,
    p_code_hash,
    p_code_prefix,
    p_code_suffix,
    v_campaign.target_tier,
    'reserved',
    lower(v_campaign.target_email),
    v_campaign.target_user_id,
    p_admin_user_id,
    v_campaign.expires_at
  )
  returning * into v_voucher;

  update public.account_voucher_campaigns
  set reserved_count = reserved_count + 1,
      updated_at = timezone('utc', now())
  where id = v_campaign.id;

  return v_voucher;
exception
  when unique_violation then
    raise exception 'VOUCHER_CODE_COLLISION';
end;
$$;

revoke all on function public.copy_next_account_voucher_code(uuid, text, text, text, uuid) from public;
grant execute on function public.copy_next_account_voucher_code(uuid, text, text, text, uuid) to service_role;

alter table public.account_tier_configs enable row level security;
alter table public.profile_feature_overrides enable row level security;
alter table public.account_upgrade_requests enable row level security;
alter table public.account_voucher_campaigns enable row level security;
alter table public.account_vouchers enable row level security;
alter table public.account_voucher_redemptions enable row level security;

drop policy if exists account_tier_configs_deny_all on public.account_tier_configs;
create policy account_tier_configs_deny_all on public.account_tier_configs
for all to anon, authenticated using (false) with check (false);

drop policy if exists profile_feature_overrides_deny_all on public.profile_feature_overrides;
create policy profile_feature_overrides_deny_all on public.profile_feature_overrides
for all to anon, authenticated using (false) with check (false);

drop policy if exists account_upgrade_requests_deny_all on public.account_upgrade_requests;
create policy account_upgrade_requests_deny_all on public.account_upgrade_requests
for all to anon, authenticated using (false) with check (false);

drop policy if exists account_voucher_campaigns_deny_all on public.account_voucher_campaigns;
create policy account_voucher_campaigns_deny_all on public.account_voucher_campaigns
for all to anon, authenticated using (false) with check (false);

drop policy if exists account_vouchers_deny_all on public.account_vouchers;
create policy account_vouchers_deny_all on public.account_vouchers
for all to anon, authenticated using (false) with check (false);

drop policy if exists account_voucher_redemptions_deny_all on public.account_voucher_redemptions;
create policy account_voucher_redemptions_deny_all on public.account_voucher_redemptions
for all to anon, authenticated using (false) with check (false);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
