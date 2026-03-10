set statement_timeout = '30s';

create table if not exists public.store_marketing_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  link_url text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.store_marketing_banners
  drop constraint if exists store_marketing_banners_sort_order_nonneg_ck;
alter table public.store_marketing_banners
  add constraint store_marketing_banners_sort_order_nonneg_ck
  check (sort_order >= 0);

alter table public.store_marketing_banners
  drop constraint if exists store_marketing_banners_link_url_http_ck;
alter table public.store_marketing_banners
  add constraint store_marketing_banners_link_url_http_ck
  check (
    link_url is null
    or link_url ~* '^https?://'
  );

create index if not exists idx_store_marketing_banners_active_order
  on public.store_marketing_banners (is_active, sort_order, created_at desc);

create index if not exists idx_store_marketing_banners_order
  on public.store_marketing_banners (sort_order, created_at desc);

alter table public.store_marketing_banners enable row level security;

drop policy if exists store_marketing_banners_select_active_public on public.store_marketing_banners;
drop policy if exists store_marketing_banners_admin_all on public.store_marketing_banners;

create policy store_marketing_banners_select_active_public
on public.store_marketing_banners
for select
to public
using (is_active = true);

create policy store_marketing_banners_admin_all
on public.store_marketing_banners
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);
