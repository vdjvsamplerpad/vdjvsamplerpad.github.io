begin;

create table if not exists public.bank_catalog_asset_variants (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.bank_catalog_items(id) on delete cascade,
  variant_type text not null,
  status text not null default 'uploading',
  manifest_storage_bucket text null,
  manifest_storage_key text null,
  total_file_size_bytes bigint null,
  part_count integer not null default 0,
  min_client_version text null,
  source_asset_sha256 text null,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.bank_catalog_asset_variants
  drop constraint if exists bank_catalog_asset_variants_variant_type_ck;

alter table public.bank_catalog_asset_variants
  add constraint bank_catalog_asset_variants_variant_type_ck
  check (variant_type in ('full', 'low_memory_segmented'));

alter table public.bank_catalog_asset_variants
  drop constraint if exists bank_catalog_asset_variants_status_ck;

alter table public.bank_catalog_asset_variants
  add constraint bank_catalog_asset_variants_status_ck
  check (status in ('uploading', 'ready', 'failed'));

create unique index if not exists idx_bank_catalog_asset_variants_unique_catalog_type
  on public.bank_catalog_asset_variants (catalog_item_id, variant_type);

create index if not exists idx_bank_catalog_asset_variants_catalog_status
  on public.bank_catalog_asset_variants (catalog_item_id, status, updated_at desc);

create table if not exists public.bank_catalog_asset_variant_parts (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.bank_catalog_asset_variants(id) on delete cascade,
  part_index integer not null check (part_index >= 0),
  storage_bucket text not null,
  storage_key text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256 text null,
  pad_start_index integer not null default 0 check (pad_start_index >= 0),
  pad_end_index integer not null default 0 check (pad_end_index >= pad_start_index),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_bank_catalog_asset_variant_parts_unique_part
  on public.bank_catalog_asset_variant_parts (variant_id, part_index);

create index if not exists idx_bank_catalog_asset_variant_parts_variant_order
  on public.bank_catalog_asset_variant_parts (variant_id, part_index, created_at);

alter table public.bank_catalog_asset_variants enable row level security;
alter table public.bank_catalog_asset_variant_parts enable row level security;

drop policy if exists bank_catalog_asset_variants_deny_all on public.bank_catalog_asset_variants;
create policy bank_catalog_asset_variants_deny_all
on public.bank_catalog_asset_variants
for all
using (false)
with check (false);

drop policy if exists bank_catalog_asset_variant_parts_deny_all on public.bank_catalog_asset_variant_parts;
create policy bank_catalog_asset_variant_parts_deny_all
on public.bank_catalog_asset_variant_parts
for all
using (false)
with check (false);

create or replace function public.touch_bank_catalog_asset_variants_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_bank_catalog_asset_variants_updated_at on public.bank_catalog_asset_variants;
create trigger trg_bank_catalog_asset_variants_updated_at
before update on public.bank_catalog_asset_variants
for each row
execute function public.touch_bank_catalog_asset_variants_updated_at();

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
