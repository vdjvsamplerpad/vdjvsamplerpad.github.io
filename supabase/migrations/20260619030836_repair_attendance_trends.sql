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
  on conflict on constraint user_daily_attendance_pkey do update
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

create or replace function public.get_admin_active_user_trend(
  p_start_date date,
  p_end_date date,
  p_excluded_user_ids uuid[] default array[]::uuid[]
)
returns table (
  bucket_date date,
  active_users integer
)
language sql
stable
set search_path = public
as $$
  with normalized as (
    select
      least(
        coalesce(p_start_date, (now() at time zone 'Asia/Manila')::date),
        coalesce(p_end_date, (now() at time zone 'Asia/Manila')::date)
      ) as start_date,
      greatest(
        coalesce(p_start_date, (now() at time zone 'Asia/Manila')::date),
        coalesce(p_end_date, (now() at time zone 'Asia/Manila')::date)
      ) as end_date,
      coalesce(p_excluded_user_ids, array[]::uuid[]) as excluded_user_ids
  ),
  buckets as (
    select generate_series(normalized.start_date, normalized.end_date, interval '1 day')::date as bucket_date
    from normalized
  ),
  seen_users as (
    select
      attendance.attendance_date as bucket_date,
      attendance.user_id as seen_user_id
    from public.user_daily_attendance attendance
    cross join normalized
    where attendance.attendance_date between normalized.start_date and normalized.end_date
      and attendance.user_id is not null
      and not (attendance.user_id = any(normalized.excluded_user_ids))

    union

    select
      (sessions.last_seen_at at time zone 'Asia/Manila')::date as bucket_date,
      sessions.user_id as seen_user_id
    from public.active_sessions sessions
    cross join normalized
    where sessions.user_id is not null
      and sessions.last_seen_at >= (normalized.start_date::timestamp at time zone 'Asia/Manila')
      and sessions.last_seen_at < ((normalized.end_date + 1)::timestamp at time zone 'Asia/Manila')
      and not (sessions.user_id = any(normalized.excluded_user_ids))
  )
  select
    buckets.bucket_date,
    count(distinct seen_users.seen_user_id)::integer as active_users
  from buckets
  left join seen_users
    on seen_users.bucket_date = buckets.bucket_date
  group by buckets.bucket_date
  order by buckets.bucket_date;
$$;

revoke all on function public.get_admin_active_user_trend(date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_active_user_trend(date, date, uuid[]) to service_role;
