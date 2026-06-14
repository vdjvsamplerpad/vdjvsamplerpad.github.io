begin;

alter table public.account_upgrade_requests
  add column if not exists ocr_reference_no text null,
  add column if not exists ocr_payer_name text null,
  add column if not exists ocr_amount_php numeric(12,2) null,
  add column if not exists ocr_recipient_number text null,
  add column if not exists ocr_provider text null,
  add column if not exists ocr_scanned_at timestamp with time zone null,
  add column if not exists ocr_status text null,
  add column if not exists ocr_error_code text null,
  add column if not exists decision_source text null,
  add column if not exists automation_result text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_upgrade_requests_ocr_amount_php_ck'
  ) then
    alter table public.account_upgrade_requests
      add constraint account_upgrade_requests_ocr_amount_php_ck
      check (ocr_amount_php is null or ocr_amount_php >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'account_upgrade_requests_ocr_status_ck'
  ) then
    alter table public.account_upgrade_requests
      add constraint account_upgrade_requests_ocr_status_ck
      check (
        ocr_status is null
        or ocr_status in (
          'detected',
          'missing_reference',
          'missing_amount',
          'missing_recipient_number',
          'failed',
          'unavailable',
          'skipped'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'account_upgrade_requests_decision_source_ck'
  ) then
    alter table public.account_upgrade_requests
      add constraint account_upgrade_requests_decision_source_ck
      check (decision_source is null or decision_source in ('manual', 'automation'));
  end if;
end $$;

create index if not exists idx_account_upgrade_requests_ocr_reference_no
  on public.account_upgrade_requests (ocr_reference_no);

create index if not exists idx_account_upgrade_requests_automation_result
  on public.account_upgrade_requests (automation_result);

alter table public.payment_reference_registry
  drop constraint if exists payment_reference_registry_source_table_ck;

alter table public.payment_reference_registry
  add constraint payment_reference_registry_source_table_ck
  check (
    source_table in (
      'account_registration_requests',
      'account_upgrade_requests',
      'bank_purchase_requests',
      'installer_purchase_requests'
    )
  );

create or replace function public.claim_payment_reference(
  p_source_reference text,
  p_source_table text,
  p_source_request_id uuid
)
returns table (
  reserved boolean,
  normalized_reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized text;
begin
  if coalesce(length(trim(p_source_reference)), 0) = 0 then
    reserved := false;
    normalized_reference := null;
    return next;
    return;
  end if;

  if p_source_table not in (
    'account_registration_requests',
    'account_upgrade_requests',
    'bank_purchase_requests',
    'installer_purchase_requests'
  ) then
    raise exception 'Invalid source table';
  end if;

  v_normalized := upper(regexp_replace(trim(p_source_reference), '\s+', '', 'g'));

  insert into public.payment_reference_registry (
    normalized_reference,
    source_reference,
    source_table,
    source_request_id
  )
  values (
    v_normalized,
    trim(p_source_reference),
    p_source_table,
    p_source_request_id
  )
  on conflict on constraint payment_reference_registry_pkey do nothing;

  reserved := found;
  normalized_reference := v_normalized;
  return next;
end;
$$;

revoke all on function public.claim_payment_reference(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_payment_reference(text, text, uuid) to service_role;

commit;
