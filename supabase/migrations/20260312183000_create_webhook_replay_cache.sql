create table if not exists public.webhook_replay_cache (
  replay_key text primary key,
  route text not null,
  requester_ip text null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create index if not exists webhook_replay_cache_expires_at_idx
  on public.webhook_replay_cache (expires_at);

alter table public.webhook_replay_cache disable row level security;
