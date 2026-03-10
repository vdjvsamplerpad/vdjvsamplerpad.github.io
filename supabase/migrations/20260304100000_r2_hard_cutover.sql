begin;

alter table public.bank_catalog_items
  add column if not exists storage_provider text;

update public.bank_catalog_items
set storage_provider = 'r2'
where storage_provider is null;

alter table public.bank_catalog_items
  alter column storage_provider set default 'r2';

alter table public.bank_catalog_items
  alter column storage_provider set not null;

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_items_storage_provider_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_items_storage_provider_ck
  check (storage_provider in ('r2'));

alter table public.bank_catalog_items
  add column if not exists storage_bucket text;

update public.bank_catalog_items
set storage_bucket = ''
where storage_bucket is null;

alter table public.bank_catalog_items
  alter column storage_bucket set default '';

alter table public.bank_catalog_items
  alter column storage_bucket set not null;

alter table public.bank_catalog_items
  add column if not exists storage_key text;

update public.bank_catalog_items
set storage_key = ''
where storage_key is null;

alter table public.bank_catalog_items
  alter column storage_key set default '';

alter table public.bank_catalog_items
  alter column storage_key set not null;

alter table public.bank_catalog_items
  add column if not exists storage_etag text null;

alter table public.bank_catalog_items
  add column if not exists storage_uploaded_at timestamptz null;

create unique index if not exists idx_bank_catalog_items_storage_object_unique
  on public.bank_catalog_items (storage_provider, storage_bucket, storage_key)
  where storage_bucket <> '' and storage_key <> '';

alter table public.user_bank_export_snapshots
  add column if not exists storage_provider text null;

alter table public.user_bank_export_snapshots
  drop constraint if exists user_bank_export_snapshots_storage_provider_ck;

alter table public.user_bank_export_snapshots
  add constraint user_bank_export_snapshots_storage_provider_ck
  check (storage_provider is null or storage_provider in ('r2'));

alter table public.user_bank_export_snapshots
  add column if not exists storage_bucket text null;

alter table public.user_bank_export_snapshots
  add column if not exists storage_key text null;

alter table public.user_bank_export_snapshots
  add column if not exists storage_etag text null;

alter table public.user_bank_export_snapshots
  add column if not exists storage_uploaded_at timestamptz null;

create table if not exists public.r2_direct_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz null,
  scope text not null check (scope in ('user_export', 'admin_catalog')),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  export_operation_id uuid null,
  catalog_item_id uuid null references public.bank_catalog_items(id) on delete set null,
  bank_id uuid null references public.banks(id) on delete set null,
  storage_bucket text not null,
  storage_key text not null,
  expected_file_size_bytes bigint not null check (expected_file_size_bytes > 0),
  expected_sha256 text null,
  status text not null default 'issued' check (status in ('issued', 'completed', 'failed', 'expired')),
  failure_reason text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_r2_direct_upload_sessions_actor_scope_created
  on public.r2_direct_upload_sessions (actor_user_id, scope, created_at desc);

create index if not exists idx_r2_direct_upload_sessions_status_expires
  on public.r2_direct_upload_sessions (status, expires_at asc);

create index if not exists idx_r2_direct_upload_sessions_export_operation
  on public.r2_direct_upload_sessions (export_operation_id)
  where export_operation_id is not null;

create index if not exists idx_r2_direct_upload_sessions_catalog_item
  on public.r2_direct_upload_sessions (catalog_item_id)
  where catalog_item_id is not null;

create or replace function public.touch_r2_direct_upload_sessions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_r2_direct_upload_sessions_updated_at on public.r2_direct_upload_sessions;

create trigger trg_r2_direct_upload_sessions_updated_at
before update on public.r2_direct_upload_sessions
for each row
execute function public.touch_r2_direct_upload_sessions_updated_at();

alter table public.r2_direct_upload_sessions enable row level security;

drop policy if exists r2_direct_upload_sessions_deny_all on public.r2_direct_upload_sessions;

create policy r2_direct_upload_sessions_deny_all
on public.r2_direct_upload_sessions
for all
using (false)
with check (false);

commit;
