alter table public.bank_catalog_items
  add column if not exists is_pinned boolean;

update public.bank_catalog_items
set is_pinned = false
where is_pinned is null;

alter table public.bank_catalog_items
  alter column is_pinned set default false;

alter table public.bank_catalog_items
  alter column is_pinned set not null;

create index if not exists idx_bank_catalog_items_store_listing
  on public.bank_catalog_items (is_published, is_pinned desc, created_at desc);
