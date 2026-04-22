begin;

with ranked_pending as (
  select
    id,
    row_number() over (partition by user_id, target_tier order by created_at desc, id desc) as rn
  from public.account_upgrade_requests
  where status = 'pending'
    and user_id is not null
)
update public.account_upgrade_requests r
set status = 'cancelled',
    rejection_message = coalesce(r.rejection_message, 'Auto-cancelled duplicate pending request during tier guardrail migration.'),
    updated_at = timezone('utc', now())
from ranked_pending d
where r.id = d.id
  and d.rn > 1;

create unique index if not exists ux_account_upgrade_requests_one_pending_per_tier
  on public.account_upgrade_requests (user_id, target_tier)
  where status = 'pending' and user_id is not null;

update public.account_tier_configs
set description = 'All PRO features plus a snapshot grant of Store banks published at upgrade time.',
    updated_at = timezone('utc', now())
where tier = 'pro_max';

insert into public.user_bank_access (user_id, bank_id)
select distinct p.id, c.bank_id
from public.profiles p
join public.bank_catalog_items c
  on c.is_published = true
 and coalesce(c.coming_soon, false) = false
 and coalesce(c.item_type, 'single_bank') = 'single_bank'
 and c.bank_id is not null
where (p.role = 'admin' or p.account_tier = 'pro_max')
on conflict (user_id, bank_id) do nothing;

notify pgrst, 'reload schema';

commit;
