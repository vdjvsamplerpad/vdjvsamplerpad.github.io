alter table public.store_marketing_banners
  add column if not exists schedule_mode text not null default 'always',
  add column if not exists starts_at timestamptz null,
  add column if not exists ends_at timestamptz null,
  add column if not exists timezone text not null default 'Asia/Manila';

update public.store_marketing_banners
set
  schedule_mode = coalesce(nullif(schedule_mode, ''), 'always'),
  timezone = coalesce(nullif(timezone, ''), 'Asia/Manila')
where schedule_mode is null
  or schedule_mode = ''
  or timezone is null
  or timezone = '';

alter table public.store_marketing_banners
  drop constraint if exists store_marketing_banners_schedule_mode_ck;

alter table public.store_marketing_banners
  add constraint store_marketing_banners_schedule_mode_ck
  check (schedule_mode in ('always', 'scheduled'));

alter table public.store_marketing_banners
  drop constraint if exists store_marketing_banners_schedule_window_ck;

alter table public.store_marketing_banners
  add constraint store_marketing_banners_schedule_window_ck
  check (
    schedule_mode = 'always'
    or (
      starts_at is not null
      and ends_at is not null
      and starts_at < ends_at
    )
  );

create index if not exists idx_store_marketing_banners_live_schedule
  on public.store_marketing_banners (is_active, schedule_mode, starts_at, ends_at, sort_order, updated_at desc);
