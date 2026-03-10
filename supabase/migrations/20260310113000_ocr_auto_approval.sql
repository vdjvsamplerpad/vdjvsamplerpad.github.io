begin;

create table if not exists public.payment_reference_registry (
  normalized_reference text primary key,
  source_reference text not null,
  source_table text not null,
  source_request_id uuid null,
  created_at timestamp with time zone not null default now(),
  constraint payment_reference_registry_source_table_ck
    check (source_table in ('account_registration_requests', 'bank_purchase_requests'))
);

alter table public.account_registration_requests
  add column if not exists ocr_reference_no text null,
  add column if not exists ocr_payer_name text null,
  add column if not exists ocr_amount_php numeric(12,2) null,
  add column if not exists ocr_provider text null,
  add column if not exists ocr_scanned_at timestamp with time zone null,
  add column if not exists ocr_status text null,
  add column if not exists ocr_error_code text null,
  add column if not exists decision_source text null,
  add column if not exists automation_result text null;

alter table public.bank_purchase_requests
  add column if not exists ocr_reference_no text null,
  add column if not exists ocr_payer_name text null,
  add column if not exists ocr_amount_php numeric(12,2) null,
  add column if not exists ocr_provider text null,
  add column if not exists ocr_scanned_at timestamp with time zone null,
  add column if not exists ocr_status text null,
  add column if not exists ocr_error_code text null,
  add column if not exists decision_source text null,
  add column if not exists automation_result text null;

alter table public.store_payment_settings
  add column if not exists account_auto_approve_enabled boolean,
  add column if not exists account_auto_approve_start_hour smallint,
  add column if not exists account_auto_approve_end_hour smallint,
  add column if not exists store_auto_approve_enabled boolean,
  add column if not exists store_auto_approve_start_hour smallint,
  add column if not exists store_auto_approve_end_hour smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_registration_requests_ocr_amount_php_ck'
  ) then
    alter table public.account_registration_requests
      add constraint account_registration_requests_ocr_amount_php_ck
      check (ocr_amount_php is null or ocr_amount_php >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bank_purchase_requests_ocr_amount_php_ck'
  ) then
    alter table public.bank_purchase_requests
      add constraint bank_purchase_requests_ocr_amount_php_ck
      check (ocr_amount_php is null or ocr_amount_php >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_registration_requests_ocr_status_ck'
  ) then
    alter table public.account_registration_requests
      add constraint account_registration_requests_ocr_status_ck
      check (ocr_status is null or ocr_status in ('detected', 'missing_reference', 'missing_amount', 'failed', 'unavailable'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bank_purchase_requests_ocr_status_ck'
  ) then
    alter table public.bank_purchase_requests
      add constraint bank_purchase_requests_ocr_status_ck
      check (ocr_status is null or ocr_status in ('detected', 'missing_reference', 'missing_amount', 'failed', 'unavailable'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_registration_requests_decision_source_ck'
  ) then
    alter table public.account_registration_requests
      add constraint account_registration_requests_decision_source_ck
      check (decision_source is null or decision_source in ('manual', 'automation'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bank_purchase_requests_decision_source_ck'
  ) then
    alter table public.bank_purchase_requests
      add constraint bank_purchase_requests_decision_source_ck
      check (decision_source is null or decision_source in ('manual', 'automation'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_account_auto_approve_hour_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_account_auto_approve_hour_ck
      check (
        account_auto_approve_start_hour is null
        or (account_auto_approve_start_hour >= 0 and account_auto_approve_start_hour <= 23)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_account_auto_approve_end_hour_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_account_auto_approve_end_hour_ck
      check (
        account_auto_approve_end_hour is null
        or (account_auto_approve_end_hour >= 0 and account_auto_approve_end_hour <= 23)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_store_auto_approve_hour_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_store_auto_approve_hour_ck
      check (
        store_auto_approve_start_hour is null
        or (store_auto_approve_start_hour >= 0 and store_auto_approve_start_hour <= 23)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_store_auto_approve_end_hour_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_store_auto_approve_end_hour_ck
      check (
        store_auto_approve_end_hour is null
        or (store_auto_approve_end_hour >= 0 and store_auto_approve_end_hour <= 23)
      );
  end if;
end;
$$;

update public.store_payment_settings
set
  account_auto_approve_enabled = coalesce(account_auto_approve_enabled, false),
  account_auto_approve_start_hour = coalesce(account_auto_approve_start_hour, 0),
  account_auto_approve_end_hour = coalesce(account_auto_approve_end_hour, 0),
  store_auto_approve_enabled = coalesce(store_auto_approve_enabled, false),
  store_auto_approve_start_hour = coalesce(store_auto_approve_start_hour, 0),
  store_auto_approve_end_hour = coalesce(store_auto_approve_end_hour, 0)
where true;

insert into public.payment_reference_registry (
  normalized_reference,
  source_reference,
  source_table,
  source_request_id
)
select distinct
  upper(regexp_replace(btrim(reference_no), '\s+', '', 'g')) as normalized_reference,
  reference_no as source_reference,
  'account_registration_requests' as source_table,
  id as source_request_id
from public.account_registration_requests
where coalesce(btrim(reference_no), '') <> ''
on conflict (normalized_reference) do nothing;

insert into public.payment_reference_registry (
  normalized_reference,
  source_reference,
  source_table,
  source_request_id
)
select distinct
  upper(regexp_replace(btrim(reference_no), '\s+', '', 'g')) as normalized_reference,
  reference_no as source_reference,
  'bank_purchase_requests' as source_table,
  id as source_request_id
from public.bank_purchase_requests
where coalesce(btrim(reference_no), '') <> ''
on conflict (normalized_reference) do nothing;

create index if not exists idx_account_registration_requests_ocr_reference_no
  on public.account_registration_requests (ocr_reference_no);

create index if not exists idx_bank_purchase_requests_ocr_reference_no
  on public.bank_purchase_requests (ocr_reference_no);

create index if not exists idx_account_registration_requests_automation_result
  on public.account_registration_requests (automation_result);

create index if not exists idx_bank_purchase_requests_automation_result
  on public.bank_purchase_requests (automation_result);

commit;
