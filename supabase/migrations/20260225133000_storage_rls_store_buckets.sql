set statement_timeout = '30s';

insert into storage.buckets (id, name, public)
values
  ('payment-proof', 'payment-proof', false),
  ('store-assets', 'store-assets', true)
on conflict (id) do nothing;

update storage.buckets
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
where id = 'payment-proof';

update storage.buckets
set
  public = true,
  file_size_limit = 20971520,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
where id = 'store-assets';

drop policy if exists payment_proof_select_owner_or_admin on storage.objects;
drop policy if exists payment_proof_insert_owner_or_admin on storage.objects;
drop policy if exists payment_proof_update_owner_or_admin on storage.objects;
drop policy if exists payment_proof_delete_owner_or_admin on storage.objects;
drop policy if exists store_assets_select_public on storage.objects;
drop policy if exists store_assets_insert_admin on storage.objects;
drop policy if exists store_assets_update_admin on storage.objects;
drop policy if exists store_assets_delete_admin on storage.objects;

create policy payment_proof_select_owner_or_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proof'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
  )
);

create policy payment_proof_insert_owner_or_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-proof'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
  )
);

create policy payment_proof_update_owner_or_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payment-proof'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
  )
)
with check (
  bucket_id = 'payment-proof'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
  )
);

create policy payment_proof_delete_owner_or_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-proof'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
  )
);

create policy store_assets_select_public
on storage.objects
for select
to public
using (bucket_id = 'store-assets');

create policy store_assets_insert_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'store-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy store_assets_update_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'store-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
)
with check (
  bucket_id = 'store-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

create policy store_assets_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'store-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);
