alter table public.store_payment_settings
  add column if not exists store_maintenance_enabled boolean not null default false,
  add column if not exists store_maintenance_message text;
