begin;

alter table public.bank_catalog_items
  alter column bank_id drop not null;

update public.bank_catalog_items
set bank_id = null
where item_type = 'bank_bundle';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
