set statement_timeout = '30s';

create table if not exists public.api_rate_limit_counters (
  scope text not null,
  subject text not null,
  window_started_at timestamp with time zone not null,
  hits integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint api_rate_limit_counters_pkey primary key (scope, subject),
  constraint api_rate_limit_counters_hits_nonneg_ck check (hits >= 0)
);

create index if not exists idx_api_rate_limit_counters_updated_at
  on public.api_rate_limit_counters (updated_at);

alter table public.api_rate_limit_counters enable row level security;

revoke all on table public.api_rate_limit_counters from anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp with time zone := now();
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 1), 1);
  v_window_reset_before timestamp with time zone := v_now - make_interval(secs => v_window_seconds);
  v_row public.api_rate_limit_counters%rowtype;
begin
  if coalesce(length(trim(p_scope)), 0) = 0 then
    raise exception 'p_scope is required';
  end if;
  if coalesce(length(trim(p_subject)), 0) = 0 then
    raise exception 'p_subject is required';
  end if;

  insert into public.api_rate_limit_counters (scope, subject, window_started_at, hits, updated_at)
  values (trim(p_scope), trim(p_subject), v_now, 1, v_now)
  on conflict (scope, subject)
  do update set
    hits = case
      when public.api_rate_limit_counters.window_started_at <= v_window_reset_before then 1
      else public.api_rate_limit_counters.hits + 1
    end,
    window_started_at = case
      when public.api_rate_limit_counters.window_started_at <= v_window_reset_before then v_now
      else public.api_rate_limit_counters.window_started_at
    end,
    updated_at = v_now
  returning * into v_row;

  if v_row.hits > v_limit then
    allowed := false;
    remaining := 0;
    retry_after_seconds := greatest(
      1,
      v_window_seconds - floor(extract(epoch from (v_now - v_row.window_started_at)))::integer
    );
  else
    allowed := true;
    remaining := greatest(0, v_limit - v_row.hits);
    retry_after_seconds := 0;
  end if;

  if random() < 0.01 then
    with stale as (
      select scope, subject
      from public.api_rate_limit_counters
      where updated_at < (v_now - interval '14 days')
      order by updated_at asc
      limit 200
    )
    delete from public.api_rate_limit_counters c
    using stale
    where c.scope = stale.scope and c.subject = stale.subject;
  end if;

  return next;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;
