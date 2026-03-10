alter table public.account_registration_requests
  add column if not exists receipt_reference text null;

alter table public.bank_purchase_requests
  add column if not exists receipt_reference text null;

create index if not exists idx_account_registration_requests_receipt_reference
  on public.account_registration_requests (receipt_reference);

create index if not exists idx_bank_purchase_requests_receipt_reference
  on public.bank_purchase_requests (receipt_reference);
