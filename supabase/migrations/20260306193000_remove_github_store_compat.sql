begin;

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_publish_fields_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_publish_fields_ck
  check (
    is_published = false
    or (
      file_size_bytes is not null
      and file_size_bytes > 0
      and coalesce(storage_provider, '') = 'r2'
      and coalesce(storage_bucket, '') <> ''
      and coalesce(storage_key, '') <> ''
    )
  );

alter table public.bank_catalog_items
  drop column if exists github_release_tag,
  drop column if exists github_asset_name;

drop table if exists public.github_direct_upload_sessions;
drop function if exists public.touch_github_direct_upload_sessions_updated_at();

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
