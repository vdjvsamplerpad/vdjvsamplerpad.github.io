create table if not exists public.user_daily_attendance (
  user_id uuid not null references auth.users (id) on delete cascade,
  attendance_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  heartbeat_count integer not null default 0 check (heartbeat_count >= 0),
  latest_session_key uuid,
  latest_email text,
  latest_device_fingerprint text,
  latest_device_name text,
  latest_platform text,
  latest_browser text,
  latest_os text,
  latest_app_version text,
  latest_runtime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, attendance_date)
);

create index if not exists idx_user_daily_attendance_date_last_seen
  on public.user_daily_attendance (attendance_date desc, last_seen_at desc);

create index if not exists idx_user_daily_attendance_user_date
  on public.user_daily_attendance (user_id, attendance_date desc);

alter table public.user_daily_attendance enable row level security;

revoke all on table public.user_daily_attendance from public, anon, authenticated;
grant select, insert, update, delete on table public.user_daily_attendance to service_role;

drop policy if exists user_daily_attendance_deny_all on public.user_daily_attendance;
create policy user_daily_attendance_deny_all
  on public.user_daily_attendance
  for all
  using (false)
  with check (false);

create or replace function public.record_user_daily_attendance(
  p_user_id uuid,
  p_email text default null,
  p_session_key uuid default null,
  p_device_fingerprint text default null,
  p_device_name text default null,
  p_platform text default null,
  p_browser text default null,
  p_os text default null,
  p_app_version text default null,
  p_runtime text default null,
  p_seen_at timestamptz default now(),
  p_increment_heartbeat boolean default true
)
returns table (
  user_id uuid,
  attendance_date date,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  heartbeat_count integer,
  attendance_days_7 integer,
  attendance_days_30 integer,
  attendance_days_total integer
)
language plpgsql
set search_path = public
as $$
declare
  v_seen_at timestamptz := coalesce(p_seen_at, now());
  v_attendance_date date := (coalesce(p_seen_at, now()) at time zone 'Asia/Manila')::date;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.user_daily_attendance (
    user_id,
    attendance_date,
    first_seen_at,
    last_seen_at,
    heartbeat_count,
    latest_session_key,
    latest_email,
    latest_device_fingerprint,
    latest_device_name,
    latest_platform,
    latest_browser,
    latest_os,
    latest_app_version,
    latest_runtime
  )
  values (
    p_user_id,
    v_attendance_date,
    v_seen_at,
    v_seen_at,
    case when p_increment_heartbeat then 1 else 0 end,
    p_session_key,
    nullif(left(coalesce(p_email, ''), 320), ''),
    nullif(left(coalesce(p_device_fingerprint, ''), 256), ''),
    nullif(left(coalesce(p_device_name, ''), 200), ''),
    nullif(left(coalesce(p_platform, ''), 120), ''),
    nullif(left(coalesce(p_browser, ''), 120), ''),
    nullif(left(coalesce(p_os, ''), 120), ''),
    nullif(left(coalesce(p_app_version, ''), 80), ''),
    nullif(left(coalesce(p_runtime, ''), 80), '')
  )
  on conflict (user_id, attendance_date) do update
  set
    first_seen_at = least(public.user_daily_attendance.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.user_daily_attendance.last_seen_at, excluded.last_seen_at),
    heartbeat_count = public.user_daily_attendance.heartbeat_count + case when p_increment_heartbeat then 1 else 0 end,
    latest_session_key = coalesce(excluded.latest_session_key, public.user_daily_attendance.latest_session_key),
    latest_email = coalesce(excluded.latest_email, public.user_daily_attendance.latest_email),
    latest_device_fingerprint = coalesce(excluded.latest_device_fingerprint, public.user_daily_attendance.latest_device_fingerprint),
    latest_device_name = coalesce(excluded.latest_device_name, public.user_daily_attendance.latest_device_name),
    latest_platform = coalesce(excluded.latest_platform, public.user_daily_attendance.latest_platform),
    latest_browser = coalesce(excluded.latest_browser, public.user_daily_attendance.latest_browser),
    latest_os = coalesce(excluded.latest_os, public.user_daily_attendance.latest_os),
    latest_app_version = coalesce(excluded.latest_app_version, public.user_daily_attendance.latest_app_version),
    latest_runtime = coalesce(excluded.latest_runtime, public.user_daily_attendance.latest_runtime),
    updated_at = now();

  return query
  select
    uda.user_id,
    uda.attendance_date,
    uda.first_seen_at,
    uda.last_seen_at,
    uda.heartbeat_count,
    (
      select count(*)::integer
      from public.user_daily_attendance last7
      where last7.user_id = p_user_id
        and last7.attendance_date >= v_attendance_date - 6
        and last7.attendance_date <= v_attendance_date
    ) as attendance_days_7,
    (
      select count(*)::integer
      from public.user_daily_attendance last30
      where last30.user_id = p_user_id
        and last30.attendance_date >= v_attendance_date - 29
        and last30.attendance_date <= v_attendance_date
    ) as attendance_days_30,
    (
      select count(*)::integer
      from public.user_daily_attendance total
      where total.user_id = p_user_id
    ) as attendance_days_total
  from public.user_daily_attendance uda
  where uda.user_id = p_user_id
    and uda.attendance_date = v_attendance_date;
end;
$$;

revoke all on function public.record_user_daily_attendance(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function public.record_user_daily_attendance(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  boolean
) to service_role;

do $$
begin
  if to_regclass('public.active_sessions') is not null then
    insert into public.user_daily_attendance (
      user_id,
      attendance_date,
      first_seen_at,
      last_seen_at,
      heartbeat_count,
      latest_session_key,
      latest_email,
      latest_device_fingerprint,
      latest_device_name,
      latest_platform,
      latest_browser,
      latest_os,
      latest_app_version,
      latest_runtime
    )
    select
      active_sessions.user_id,
      (max(active_sessions.last_seen_at) at time zone 'Asia/Manila')::date as attendance_date,
      min(active_sessions.last_seen_at) as first_seen_at,
      max(active_sessions.last_seen_at) as last_seen_at,
      greatest(count(*)::integer, 1) as heartbeat_count,
      (array_agg(active_sessions.session_key order by active_sessions.last_seen_at desc))[1] as latest_session_key,
      (array_agg(active_sessions.email order by active_sessions.last_seen_at desc))[1] as latest_email,
      (array_agg(active_sessions.device_fingerprint order by active_sessions.last_seen_at desc))[1] as latest_device_fingerprint,
      (array_agg(active_sessions.device_name order by active_sessions.last_seen_at desc))[1] as latest_device_name,
      (array_agg(active_sessions.platform order by active_sessions.last_seen_at desc))[1] as latest_platform,
      (array_agg(active_sessions.browser order by active_sessions.last_seen_at desc))[1] as latest_browser,
      (array_agg(active_sessions.os order by active_sessions.last_seen_at desc))[1] as latest_os,
      (array_agg(active_sessions.meta->>'appVersion' order by active_sessions.last_seen_at desc))[1] as latest_app_version,
      (array_agg(active_sessions.meta->>'runtime' order by active_sessions.last_seen_at desc))[1] as latest_runtime
    from public.active_sessions
    where active_sessions.user_id is not null
      and active_sessions.last_seen_at is not null
    group by active_sessions.user_id, (active_sessions.last_seen_at at time zone 'Asia/Manila')::date
    on conflict (user_id, attendance_date) do update
    set
      first_seen_at = least(public.user_daily_attendance.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.user_daily_attendance.last_seen_at, excluded.last_seen_at),
      heartbeat_count = greatest(public.user_daily_attendance.heartbeat_count, excluded.heartbeat_count),
      latest_session_key = coalesce(excluded.latest_session_key, public.user_daily_attendance.latest_session_key),
      latest_email = coalesce(excluded.latest_email, public.user_daily_attendance.latest_email),
      latest_device_fingerprint = coalesce(excluded.latest_device_fingerprint, public.user_daily_attendance.latest_device_fingerprint),
      latest_device_name = coalesce(excluded.latest_device_name, public.user_daily_attendance.latest_device_name),
      latest_platform = coalesce(excluded.latest_platform, public.user_daily_attendance.latest_platform),
      latest_browser = coalesce(excluded.latest_browser, public.user_daily_attendance.latest_browser),
      latest_os = coalesce(excluded.latest_os, public.user_daily_attendance.latest_os),
      latest_app_version = coalesce(excluded.latest_app_version, public.user_daily_attendance.latest_app_version),
      latest_runtime = coalesce(excluded.latest_runtime, public.user_daily_attendance.latest_runtime),
      updated_at = now();
  end if;
end $$;
