set statement_timeout = '30s';

alter table public.account_registration_requests
  add column if not exists is_refunded boolean not null default false,
  add column if not exists refunded_at timestamptz null,
  add column if not exists refunded_by uuid null references auth.users(id) on delete set null;

alter table public.bank_purchase_requests
  add column if not exists is_refunded boolean not null default false,
  add column if not exists refunded_at timestamptz null,
  add column if not exists refunded_by uuid null references auth.users(id) on delete set null;

alter table public.installer_purchase_requests
  add column if not exists is_refunded boolean not null default false,
  add column if not exists refunded_at timestamptz null,
  add column if not exists refunded_by uuid null references auth.users(id) on delete set null;

create index if not exists idx_account_registration_requests_refund_status
  on public.account_registration_requests (status, is_refunded, created_at desc);

create index if not exists idx_bank_purchase_requests_refund_status
  on public.bank_purchase_requests (status, is_refunded, created_at desc);

create index if not exists idx_installer_purchase_requests_refund_status
  on public.installer_purchase_requests (status, is_refunded, created_at desc);

create or replace view public.v_admin_dashboard_revenue_totals
with (security_invoker = true)
as
select
  coalesce(
    (
      select sum(coalesce(price_php_snapshot, 0)::numeric)
      from public.bank_purchase_requests
      where status = 'approved'
        and coalesce(is_refunded, false) = false
    ),
    0
  )::numeric(14, 2) as store_revenue_approved_total,
  coalesce(
    (
      select sum(coalesce(account_price_php_snapshot, 0)::numeric)
      from public.account_registration_requests
      where status = 'approved'
        and coalesce(is_refunded, false) = false
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
      select count(distinct coalesce(nullif(email_normalized, ''), lower(trim(email))))
      from public.account_registration_requests
      where status = 'approved'
        and coalesce(nullif(email_normalized, ''), lower(trim(email))) <> ''
    ),
    0
  )::bigint as account_buyers_approved_total;

create or replace view public.v_admin_dashboard_revenue_daily
with (security_invoker = true)
as
with store as (
  select
    (created_at at time zone 'UTC')::date as date_utc,
    coalesce(
      sum(
        case
          when status = 'approved' and coalesce(is_refunded, false) = false
            then coalesce(price_php_snapshot, 0)::numeric
          else 0::numeric
        end
      ),
      0
    )::numeric(14, 2) as store_revenue_approved,
    count(distinct case when status = 'approved' then user_id else null end)::bigint as store_buyers_approved,
    count(*)::bigint as store_requests_total
  from public.bank_purchase_requests
  group by 1
),
account as (
  select
    (created_at at time zone 'UTC')::date as date_utc,
    coalesce(
      sum(
        case
          when status = 'approved' and coalesce(is_refunded, false) = false
            then coalesce(account_price_php_snapshot, 0)::numeric
          else 0::numeric
        end
      ),
      0
    )::numeric(14, 2) as account_revenue_approved,
    count(
      distinct case
        when status = 'approved' then coalesce(nullif(email_normalized, ''), lower(trim(email)))
        else null
      end
    )::bigint as account_buyers_approved
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

revoke all on public.v_admin_dashboard_revenue_totals from public, anon, authenticated;
revoke all on public.v_admin_dashboard_revenue_daily from public, anon, authenticated;
