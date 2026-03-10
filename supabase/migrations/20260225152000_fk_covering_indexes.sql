set statement_timeout = '60s';

create index if not exists idx_bank_purchase_requests_bank_id
  on public.bank_purchase_requests (bank_id);

create index if not exists idx_bank_purchase_requests_catalog_item_id
  on public.bank_purchase_requests (catalog_item_id);

create index if not exists idx_bank_purchase_requests_reviewed_by
  on public.bank_purchase_requests (reviewed_by);

create index if not exists idx_banks_created_by
  on public.banks (created_by);

create index if not exists idx_banks_deleted_by
  on public.banks (deleted_by);

create index if not exists idx_store_payment_settings_updated_by
  on public.store_payment_settings (updated_by);

create index if not exists idx_user_bank_access_bank_id
  on public.user_bank_access (bank_id);
