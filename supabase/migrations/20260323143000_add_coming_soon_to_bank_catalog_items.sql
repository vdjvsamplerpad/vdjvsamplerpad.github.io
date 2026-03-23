alter table public.bank_catalog_items
  add column if not exists coming_soon boolean not null default false;
