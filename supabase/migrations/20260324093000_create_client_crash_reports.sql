create table if not exists public.client_crash_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (domain in ('bank_store')),
  fingerprint text not null,
  fingerprint_version integer not null default 1,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'fixed', 'ignored')),
  report_title text not null default 'Crash Report',
  latest_operation text,
  latest_phase text,
  latest_stage text,
  platform text,
  app_version text,
  recent_event_pattern text,
  report_object_key text,
  report_uploaded_at timestamptz,
  report_size_bytes integer,
  repeat_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  latest_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_crash_reports_user_domain_fingerprint_key unique (user_id, domain, fingerprint)
);

create index if not exists idx_client_crash_reports_status_last_seen
  on public.client_crash_reports (status, last_seen_at desc);

create index if not exists idx_client_crash_reports_user_last_seen
  on public.client_crash_reports (user_id, last_seen_at desc);

alter table public.client_crash_reports enable row level security;
