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
  sessions.user_id,
  (sessions.last_seen_at at time zone 'Asia/Manila')::date as attendance_date,
  min(sessions.last_seen_at) as first_seen_at,
  max(sessions.last_seen_at) as last_seen_at,
  greatest(count(*)::integer, 1) as heartbeat_count,
  (array_agg(sessions.session_key order by sessions.last_seen_at desc))[1] as latest_session_key,
  (array_agg(sessions.email order by sessions.last_seen_at desc))[1] as latest_email,
  (array_agg(sessions.device_fingerprint order by sessions.last_seen_at desc))[1] as latest_device_fingerprint,
  (array_agg(sessions.device_name order by sessions.last_seen_at desc))[1] as latest_device_name,
  (array_agg(sessions.platform order by sessions.last_seen_at desc))[1] as latest_platform,
  (array_agg(sessions.browser order by sessions.last_seen_at desc))[1] as latest_browser,
  (array_agg(sessions.os order by sessions.last_seen_at desc))[1] as latest_os,
  (array_agg(sessions.meta->>'appVersion' order by sessions.last_seen_at desc))[1] as latest_app_version,
  (array_agg(sessions.meta->>'runtime' order by sessions.last_seen_at desc))[1] as latest_runtime
from public.active_sessions sessions
where sessions.user_id is not null
  and sessions.last_seen_at is not null
group by sessions.user_id, (sessions.last_seen_at at time zone 'Asia/Manila')::date
on conflict on constraint user_daily_attendance_pkey do update
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

insert into public.user_daily_attendance (
  user_id,
  attendance_date,
  first_seen_at,
  last_seen_at,
  heartbeat_count,
  latest_email
)
select
  logs.user_id,
  (logs.created_at at time zone 'Asia/Manila')::date as attendance_date,
  min(logs.created_at) as first_seen_at,
  max(logs.created_at) as last_seen_at,
  0 as heartbeat_count,
  (array_agg(logs.email order by logs.created_at desc))[1] as latest_email
from public.activity_logs logs
where logs.user_id is not null
  and logs.created_at is not null
group by logs.user_id, (logs.created_at at time zone 'Asia/Manila')::date
on conflict on constraint user_daily_attendance_pkey do update
set
  first_seen_at = least(public.user_daily_attendance.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.user_daily_attendance.last_seen_at, excluded.last_seen_at),
  latest_email = coalesce(public.user_daily_attendance.latest_email, excluded.latest_email),
  updated_at = now();

insert into public.user_daily_attendance (
  user_id,
  attendance_date,
  first_seen_at,
  last_seen_at,
  heartbeat_count,
  latest_email
)
select
  users.id,
  (users.last_sign_in_at at time zone 'Asia/Manila')::date as attendance_date,
  users.last_sign_in_at as first_seen_at,
  users.last_sign_in_at as last_seen_at,
  0 as heartbeat_count,
  users.email as latest_email
from auth.users users
where users.last_sign_in_at is not null
  and not exists (
    select 1
    from public.user_daily_attendance attendance
    where attendance.user_id = users.id
      and attendance.attendance_date = (users.last_sign_in_at at time zone 'Asia/Manila')::date
  )
on conflict on constraint user_daily_attendance_pkey do nothing;
