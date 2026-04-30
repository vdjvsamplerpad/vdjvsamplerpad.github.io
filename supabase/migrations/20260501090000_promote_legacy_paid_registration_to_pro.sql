begin;

-- Legacy paid account-registration approvals represent the old paid V1 account
-- product. These accounts must remain PRO even though new direct signups default
-- to FREE.
update public.profiles p
set
  account_tier = 'pro',
  tier_source = 'migration_legacy',
  tier_updated_at = coalesce(r.reviewed_at, r.created_at, timezone('utc', now())),
  owned_bank_quota = coalesce(
    nullif((cfg.limits ->> 'owned_bank_quota')::integer, 0),
    p.owned_bank_quota,
    6
  ),
  owned_bank_pad_cap = coalesce(
    nullif((cfg.limits ->> 'owned_bank_pad_cap')::integer, 0),
    p.owned_bank_pad_cap,
    64
  ),
  device_total_bank_cap = coalesce(
    nullif((cfg.limits ->> 'device_total_bank_cap')::integer, 0),
    p.device_total_bank_cap,
    120
  ),
  updated_at = timezone('utc', now())
from public.account_registration_requests r
left join public.account_tier_configs cfg on cfg.tier = 'pro'
where r.approved_auth_user_id = p.id
  and r.status = 'approved'
  and coalesce(r.is_refunded, false) = false
  and p.role <> 'admin'
  and p.account_tier = 'free';

commit;
