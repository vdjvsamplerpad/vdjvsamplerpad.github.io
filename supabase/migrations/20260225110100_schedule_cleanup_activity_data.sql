-- Optional: schedule activity/session cleanup.
-- Safe to run multiple times.

do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron extension is unavailable in this environment: %', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup_activity_data_10min';

    perform cron.schedule(
      'cleanup_activity_data_10min',
      '*/10 * * * *',
      $job$select public.cleanup_activity_data();$job$
    );
  else
    raise notice 'Skipping cron scheduling because schema "cron" was not found.';
  end if;
end
$$;
