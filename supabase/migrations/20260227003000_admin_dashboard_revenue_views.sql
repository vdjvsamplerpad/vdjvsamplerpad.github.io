create index if not exists idx_bank_purchase_requests_created_at
  on public.bank_purchase_requests (created_at desc);

create or replace view public.v_admin_dashboard_revenue_totals as
select
  coalesce(
    (
      select sum(coalesce(price_php_snapshot, 0)::numeric)
      from public.bank_purchase_requests
      where status = 'approved'
    ),
    0
  )::numeric(14, 2) as store_revenue_approved_total,
  coalesce(
    (
      select sum(coalesce(account_price_php_snapshot, 0)::numeric)
      from public.account_registration_requests
      where status = 'approved'
    ),
    0
  )::numeric(14, 2) as account_revenue_approved_total,
  coalesce(
    (
      select count(distinct user_id)
      from public.bank_purchase_requests
      where status = 'approved'
        and user_id is not null
    ),
    0
  )::bigint as store_buyers_approved_total,
  coalesce(
    (
      select count(*)
      from public.account_registration_requests
      where status = 'approved'
    ),
    0
  )::bigint as account_buyers_approved_total;

create or replace view public.v_admin_dashboard_revenue_daily as
with store as (
  select
    (created_at at time zone 'UTC')::date as date_utc,
    coalesce(sum(case when status = 'approved' then coalesce(price_php_snapshot, 0)::numeric else 0::numeric end), 0)::numeric(14, 2) as store_revenue_approved,
    count(distinct case when status = 'approved' then user_id else null end)::bigint as store_buyers_approved,
    count(*)::bigint as store_requests_total
  from public.bank_purchase_requests
  group by 1
),
account as (
  select
    (created_at at time zone 'UTC')::date as date_utc,
    coalesce(sum(case when status = 'approved' then coalesce(account_price_php_snapshot, 0)::numeric else 0::numeric end), 0)::numeric(14, 2) as account_revenue_approved,
    count(*) filter (where status = 'approved')::bigint as account_buyers_approved
  from public.account_registration_requests
  group by 1
)
select
  coalesce(store.date_utc, account.date_utc) as date_utc,
  coalesce(store.store_revenue_approved, 0)::numeric(14, 2) as store_revenue_approved,
  coalesce(account.account_revenue_approved, 0)::numeric(14, 2) as account_revenue_approved,
  coalesce(store.store_buyers_approved, 0)::bigint as store_buyers_approved,
  coalesce(account.account_buyers_approved, 0)::bigint as account_buyers_approved,
  coalesce(store.store_requests_total, 0)::bigint as store_requests_total
from store
full join account on account.date_utc = store.date_utc;
