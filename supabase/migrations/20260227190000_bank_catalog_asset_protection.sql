alter table public.bank_catalog_items
  add column if not exists asset_protection text;

update public.bank_catalog_items
set asset_protection = 'encrypted'
where asset_protection is null;

alter table public.bank_catalog_items
  alter column asset_protection set default 'encrypted';

alter table public.bank_catalog_items
  alter column asset_protection set not null;

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_items_asset_protection_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_items_asset_protection_ck
  check (asset_protection in ('encrypted', 'public'));
