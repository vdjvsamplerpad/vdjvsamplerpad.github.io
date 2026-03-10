begin;

create table if not exists public.default_bank_releases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null unique check (version > 0),
  source_bank_runtime_id text null,
  source_bank_title text not null,
  source_bank_pad_count integer not null default 0 check (source_bank_pad_count >= 0),
  storage_provider text not null default 'r2',
  storage_bucket text not null,
  storage_key text not null,
  storage_etag text null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  file_sha256 text null,
  release_notes text null,
  min_app_version text null,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  is_active boolean not null default false,
  deactivated_at timestamptz null,
  deactivated_by uuid null references auth.users(id) on delete set null,
  constraint default_bank_releases_storage_provider_ck
    check (storage_provider in ('r2'))
);

create unique index if not exists idx_default_bank_releases_active_unique
  on public.default_bank_releases (is_active)
  where is_active = true;

create unique index if not exists idx_default_bank_releases_storage_object_unique
  on public.default_bank_releases (storage_provider, storage_bucket, storage_key);

create index if not exists idx_default_bank_releases_version_desc
  on public.default_bank_releases (version desc);

create index if not exists idx_default_bank_releases_published_at_desc
  on public.default_bank_releases (published_at desc);

create or replace function public.touch_default_bank_releases_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_default_bank_releases_updated_at on public.default_bank_releases;

create trigger trg_default_bank_releases_updated_at
before update on public.default_bank_releases
for each row
execute function public.touch_default_bank_releases_updated_at();

alter table public.default_bank_releases enable row level security;

drop policy if exists default_bank_releases_deny_all on public.default_bank_releases;

create policy default_bank_releases_deny_all
on public.default_bank_releases
for all
using (false)
with check (false);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
