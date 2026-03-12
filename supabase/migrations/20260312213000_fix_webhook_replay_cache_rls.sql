alter table public.webhook_replay_cache enable row level security;

drop policy if exists webhook_replay_cache_deny_all on public.webhook_replay_cache;

create policy webhook_replay_cache_deny_all
  on public.webhook_replay_cache
  for all
  using (false)
  with check (false);
