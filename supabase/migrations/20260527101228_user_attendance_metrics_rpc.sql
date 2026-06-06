create or replace function public.get_user_attendance_metrics(
  p_user_ids uuid[],
  p_today_date date default ((now() at time zone 'Asia/Manila')::date)
)
returns table (
  user_id uuid,
  attendance_date date,
  first_seen_today_at timestamptz,
  last_seen_at timestamptz,
  today_heartbeat_count integer,
  attendance_days_7 integer,
  attendance_days_30 integer,
  attendance_days_total integer
)
language sql
stable
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_user_ids, array[]::uuid[])) as user_id
  ),
  totals as (
    select
      requested.user_id,
      count(attendance.attendance_date)::integer as attendance_days_total,
      count(*) filter (
        where attendance.attendance_date between p_today_date - 6 and p_today_date
      )::integer as attendance_days_7,
      count(*) filter (
        where attendance.attendance_date between p_today_date - 29 and p_today_date
      )::integer as attendance_days_30
    from requested
    left join public.user_daily_attendance attendance
      on attendance.user_id = requested.user_id
    group by requested.user_id
  ),
  today as (
    select
      attendance.user_id,
      attendance.first_seen_at,
      attendance.last_seen_at,
      attendance.heartbeat_count
    from public.user_daily_attendance attendance
    join requested
      on requested.user_id = attendance.user_id
    where attendance.attendance_date = p_today_date
  )
  select
    requested.user_id,
    p_today_date as attendance_date,
    today.first_seen_at as first_seen_today_at,
    today.last_seen_at,
    coalesce(today.heartbeat_count, 0)::integer as today_heartbeat_count,
    coalesce(totals.attendance_days_7, 0)::integer as attendance_days_7,
    coalesce(totals.attendance_days_30, 0)::integer as attendance_days_30,
    coalesce(totals.attendance_days_total, 0)::integer as attendance_days_total
  from requested
  left join totals
    on totals.user_id = requested.user_id
  left join today
    on today.user_id = requested.user_id;
$$;

revoke all on function public.get_user_attendance_metrics(uuid[], date) from public;
grant execute on function public.get_user_attendance_metrics(uuid[], date) to service_role;
