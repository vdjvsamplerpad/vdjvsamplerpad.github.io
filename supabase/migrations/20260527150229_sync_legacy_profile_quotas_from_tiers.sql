with tier_limits as (
  select
    tier,
    coalesce(
      nullif(limits->>'owned_bank_quota', '')::integer,
      nullif(limits->>'ownedBankQuota', '')::integer,
      case tier when 'free' then 2 when 'pro' then 6 when 'pro_max' then 12 else 6 end
    ) as owned_bank_quota,
    coalesce(
      nullif(limits->>'owned_bank_pad_cap', '')::integer,
      nullif(limits->>'ownedBankPadCap', '')::integer,
      case tier when 'free' then 25 when 'pro' then 64 when 'pro_max' then 128 else 64 end
    ) as owned_bank_pad_cap,
    coalesce(
      nullif(limits->>'device_total_bank_cap', '')::integer,
      nullif(limits->>'deviceTotalBankCap', '')::integer,
      case tier when 'free' then 4 when 'pro' then 120 when 'pro_max' then 150 else 120 end
    ) as device_total_bank_cap
  from public.account_tier_configs
  where tier in ('free', 'pro', 'pro_max')
),
users_with_limit_overrides as (
  select user_id
  from public.profile_feature_overrides
  where limits is not null
    and limits <> '{}'::jsonb
)
update public.profiles profiles
set
  owned_bank_quota = greatest(least(tier_limits.owned_bank_quota, 500), 1),
  owned_bank_pad_cap = greatest(least(tier_limits.owned_bank_pad_cap, 256), 1),
  device_total_bank_cap = greatest(least(tier_limits.device_total_bank_cap, 1000), 10)
from tier_limits
where profiles.account_tier = tier_limits.tier
  and coalesce(profiles.role, 'user') <> 'admin'
  and coalesce(profiles.tier_source, '') not in ('admin', 'system')
  and not exists (
    select 1
    from users_with_limit_overrides overrides
    where overrides.user_id = profiles.id
  );

with tier_limits as (
  select
    tier,
    coalesce(
      nullif(limits->>'owned_bank_quota', '')::integer,
      nullif(limits->>'ownedBankQuota', '')::integer,
      case tier when 'free' then 2 when 'pro' then 6 when 'pro_max' then 12 else 6 end
    ) as owned_bank_quota,
    coalesce(
      nullif(limits->>'owned_bank_pad_cap', '')::integer,
      nullif(limits->>'ownedBankPadCap', '')::integer,
      case tier when 'free' then 25 when 'pro' then 64 when 'pro_max' then 128 else 64 end
    ) as owned_bank_pad_cap,
    coalesce(
      nullif(limits->>'device_total_bank_cap', '')::integer,
      nullif(limits->>'deviceTotalBankCap', '')::integer,
      case tier when 'free' then 4 when 'pro' then 120 when 'pro_max' then 150 else 120 end
    ) as device_total_bank_cap
  from public.account_tier_configs
  where tier = 'pro'
)
insert into public.sampler_app_config (
  id,
  is_active,
  quota_defaults,
  updated_at
)
select
  'default',
  true,
  jsonb_build_object(
    'ownedBankQuota', greatest(least(tier_limits.owned_bank_quota, 500), 1),
    'ownedBankPadCap', greatest(least(tier_limits.owned_bank_pad_cap, 256), 1),
    'deviceTotalBankCap', greatest(least(tier_limits.device_total_bank_cap, 1000), 10)
  ),
  now()
from tier_limits
where tier_limits.tier = 'pro'
on conflict (id) do update
set
  quota_defaults = excluded.quota_defaults,
  updated_at = excluded.updated_at;
