begin;

create table if not exists public.user_sampler_metadata_snapshots (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_version integer not null default 1 check (snapshot_version >= 1),
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_sha256 text null,
  snapshot_size_bytes integer not null default 0 check (snapshot_size_bytes >= 0)
);

create unique index if not exists idx_user_sampler_metadata_snapshots_user
  on public.user_sampler_metadata_snapshots (user_id);

create or replace function public.touch_user_sampler_metadata_snapshot_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_sampler_metadata_snapshot_updated_at on public.user_sampler_metadata_snapshots;

create trigger trg_user_sampler_metadata_snapshot_updated_at
before update on public.user_sampler_metadata_snapshots
for each row
execute function public.touch_user_sampler_metadata_snapshot_updated_at();

alter table public.user_sampler_metadata_snapshots enable row level security;

drop policy if exists user_sampler_metadata_snapshots_deny_all on public.user_sampler_metadata_snapshots;

create policy user_sampler_metadata_snapshots_deny_all
on public.user_sampler_metadata_snapshots
for all
using (false)
with check (false);

commit;
