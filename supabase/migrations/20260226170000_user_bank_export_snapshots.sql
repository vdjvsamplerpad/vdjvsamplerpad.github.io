begin;

create table if not exists public.user_bank_export_snapshots (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_id text not null,
  export_operation_id uuid not null unique,
  file_sha256 text null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  status text not null check (status in ('pending', 'uploaded', 'duplicate_no_change', 'failed')),
  release_tag text null,
  release_id bigint null,
  asset_name text null,
  duplicate_of_export_operation_id uuid null,
  failure_reason text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_user_bank_export_snapshots_user_bank_created
  on public.user_bank_export_snapshots (user_id, bank_id, created_at desc);

create index if not exists idx_user_bank_export_snapshots_user_bank_hash_created
  on public.user_bank_export_snapshots (user_id, bank_id, file_sha256, created_at desc)
  where file_sha256 is not null
    and status in ('uploaded', 'duplicate_no_change');

create index if not exists idx_user_bank_export_snapshots_export_operation
  on public.user_bank_export_snapshots (export_operation_id);

create or replace function public.touch_user_bank_export_snapshot_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_bank_export_snapshot_updated_at on public.user_bank_export_snapshots;

create trigger trg_user_bank_export_snapshot_updated_at
before update on public.user_bank_export_snapshots
for each row
execute function public.touch_user_bank_export_snapshot_updated_at();

alter table public.user_bank_export_snapshots enable row level security;

drop policy if exists user_bank_export_snapshots_deny_all on public.user_bank_export_snapshots;

create policy user_bank_export_snapshots_deny_all
on public.user_bank_export_snapshots
for all
using (false)
with check (false);

commit;
