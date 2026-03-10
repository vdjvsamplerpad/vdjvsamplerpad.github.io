begin;

create index if not exists idx_activity_logs_event_status_created_at
  on public.activity_logs (event_type, status, created_at desc);

create index if not exists idx_bank_purchase_requests_status_created_at
  on public.bank_purchase_requests (status, created_at desc);

create index if not exists idx_bank_catalog_items_published_created_at
  on public.bank_catalog_items (is_published, created_at desc);

commit;