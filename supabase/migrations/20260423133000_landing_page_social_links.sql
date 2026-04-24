alter table public.landing_download_config
  add column if not exists social_links jsonb not null default '{}'::jsonb;
