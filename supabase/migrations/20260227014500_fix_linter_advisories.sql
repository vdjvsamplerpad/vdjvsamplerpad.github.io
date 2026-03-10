set statement_timeout = '30s';

drop policy if exists store_marketing_banners_admin_all
on public.store_marketing_banners;

drop policy if exists store_marketing_banners_select_active_public
on public.store_marketing_banners;

drop policy if exists store_marketing_banners_select_public_or_admin
on public.store_marketing_banners;

drop policy if exists store_marketing_banners_insert_admin
on public.store_marketing_banners;

drop policy if exists store_marketing_banners_update_admin
on public.store_marketing_banners;

drop policy if exists store_marketing_banners_delete_admin
on public.store_marketing_banners;

create policy store_marketing_banners_select_public_or_admin
on public.store_marketing_banners
for select
to public
using (
  is_active = true
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy store_marketing_banners_insert_admin
on public.store_marketing_banners
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy store_marketing_banners_update_admin
on public.store_marketing_banners
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy store_marketing_banners_delete_admin
on public.store_marketing_banners
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

drop index if exists public.idx_account_reg_status_created;
drop index if exists public.idx_bank_catalog_items_published;
drop index if exists public.idx_bank_purchase_requests_status;
