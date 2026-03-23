alter table public.client_crash_reports
  drop constraint if exists client_crash_reports_domain_check;

alter table public.client_crash_reports
  add constraint client_crash_reports_domain_check
  check (domain in ('bank_store', 'playback', 'global_runtime'));
