begin;

alter table if exists public.account_registration_requests
  drop constraint if exists account_registration_requests_ocr_status_ck;

alter table if exists public.account_registration_requests
  add constraint account_registration_requests_ocr_status_ck
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

alter table if exists public.bank_purchase_requests
  drop constraint if exists bank_purchase_requests_ocr_status_ck;

alter table if exists public.bank_purchase_requests
  add constraint bank_purchase_requests_ocr_status_ck
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

commit;
