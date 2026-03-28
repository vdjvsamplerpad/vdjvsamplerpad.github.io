alter table public.store_promotions
  add column if not exists audience_type text not null default 'all',
  add column if not exists new_user_window_hours integer null;

alter table public.store_promotions
  drop constraint if exists store_promotions_audience_type_ck;
alter table public.store_promotions
  add constraint store_promotions_audience_type_ck
  check (audience_type in ('all', 'specific_users', 'new_users_window'));

alter table public.store_promotions
  drop constraint if exists store_promotions_new_user_window_hours_ck;
alter table public.store_promotions
  add constraint store_promotions_new_user_window_hours_ck
  check (new_user_window_hours is null or (new_user_window_hours >= 1 and new_user_window_hours <= 8760));

create table if not exists public.store_promotion_target_users (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.store_promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc', now())
);

create unique index if not exists idx_store_promotion_target_users_unique
  on public.store_promotion_target_users (promotion_id, user_id);

create index if not exists idx_store_promotion_target_users_promotion_id
  on public.store_promotion_target_users (promotion_id);

create index if not exists idx_store_promotion_target_users_user_id
  on public.store_promotion_target_users (user_id);

alter table public.store_promotion_target_users enable row level security;

drop policy if exists store_promotion_target_users_select_admin on public.store_promotion_target_users;
drop policy if exists store_promotion_target_users_insert_admin on public.store_promotion_target_users;
drop policy if exists store_promotion_target_users_update_admin on public.store_promotion_target_users;
drop policy if exists store_promotion_target_users_delete_admin on public.store_promotion_target_users;

create policy store_promotion_target_users_select_admin
on public.store_promotion_target_users
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy store_promotion_target_users_insert_admin
on public.store_promotion_target_users
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy store_promotion_target_users_update_admin
on public.store_promotion_target_users
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy store_promotion_target_users_delete_admin
on public.store_promotion_target_users
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
