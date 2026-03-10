begin;

create table if not exists public.github_direct_upload_sessions (
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
  release_tag text not null,
  release_id bigint not null check (release_id > 0),
  asset_name text not null,
  expected_file_size_bytes bigint not null check (expected_file_size_bytes > 0),
  expected_sha256 text null,
  status text not null default 'issued' check (status in ('issued', 'completed', 'failed', 'expired')),
  failure_reason text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_github_direct_upload_sessions_actor_scope_created
  on public.github_direct_upload_sessions (actor_user_id, scope, created_at desc);

create index if not exists idx_github_direct_upload_sessions_status_expires
  on public.github_direct_upload_sessions (status, expires_at asc);

create index if not exists idx_github_direct_upload_sessions_export_operation
  on public.github_direct_upload_sessions (export_operation_id)
  where export_operation_id is not null;

create index if not exists idx_github_direct_upload_sessions_catalog_item
  on public.github_direct_upload_sessions (catalog_item_id)
  where catalog_item_id is not null;

create or replace function public.touch_github_direct_upload_sessions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_github_direct_upload_sessions_updated_at on public.github_direct_upload_sessions;

create trigger trg_github_direct_upload_sessions_updated_at
before update on public.github_direct_upload_sessions
for each row
execute function public.touch_github_direct_upload_sessions_updated_at();

alter table public.github_direct_upload_sessions enable row level security;

drop policy if exists github_direct_upload_sessions_deny_all on public.github_direct_upload_sessions;

create policy github_direct_upload_sessions_deny_all
on public.github_direct_upload_sessions
for all
using (false)
with check (false);

commit;
