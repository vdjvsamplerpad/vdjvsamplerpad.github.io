alter table if exists public.account_registration_requests
  add column if not exists ocr_recipient_number text;

alter table if exists public.bank_purchase_requests
  add column if not exists ocr_recipient_number text;
