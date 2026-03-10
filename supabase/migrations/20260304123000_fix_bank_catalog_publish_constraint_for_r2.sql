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
      and (
        (
          coalesce(storage_provider, '') = 'r2'
          and coalesce(storage_bucket, '') <> ''
          and coalesce(storage_key, '') <> ''
        )
        or (
          github_release_tag is not null
          and github_asset_name is not null
        )
      )
    )
  );

commit;
