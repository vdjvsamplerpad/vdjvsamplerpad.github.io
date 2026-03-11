create table if not exists public.store_promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  promotion_type text not null default 'standard',
  discount_type text not null,
  discount_value numeric(12,2) not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  timezone text not null default 'Asia/Manila',
  badge_text text null,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc', now()),
  updated_at timestamp with time zone not null default timezone('utc', now())
);

alter table public.store_promotions
  drop constraint if exists store_promotions_promotion_type_ck;
alter table public.store_promotions
  add constraint store_promotions_promotion_type_ck
  check (promotion_type in ('standard', 'flash_sale'));

alter table public.store_promotions
  drop constraint if exists store_promotions_discount_type_ck;
alter table public.store_promotions
  add constraint store_promotions_discount_type_ck
  check (discount_type in ('percent', 'fixed'));

alter table public.store_promotions
  drop constraint if exists store_promotions_discount_value_ck;
alter table public.store_promotions
  add constraint store_promotions_discount_value_ck
  check (
    (discount_type = 'percent' and discount_value > 0 and discount_value < 100)
    or (discount_type = 'fixed' and discount_value > 0)
  );

alter table public.store_promotions
  drop constraint if exists store_promotions_priority_ck;
alter table public.store_promotions
  add constraint store_promotions_priority_ck
  check (priority >= 0 and priority <= 100000);

alter table public.store_promotions
  drop constraint if exists store_promotions_window_ck;
alter table public.store_promotions
  add constraint store_promotions_window_ck
  check (ends_at > starts_at);

create table if not exists public.store_promotion_targets (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.store_promotions(id) on delete cascade,
  bank_id uuid null references public.banks(id) on delete cascade,
  catalog_item_id uuid null references public.bank_catalog_items(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc', now())
);

alter table public.store_promotion_targets
  drop constraint if exists store_promotion_targets_exactly_one_target_ck;
alter table public.store_promotion_targets
  add constraint store_promotion_targets_exactly_one_target_ck
  check (
    ((bank_id is not null)::integer + (catalog_item_id is not null)::integer) = 1
  );

create unique index if not exists idx_store_promotion_targets_unique_bank
  on public.store_promotion_targets (promotion_id, bank_id)
  where bank_id is not null;

create unique index if not exists idx_store_promotion_targets_unique_catalog
  on public.store_promotion_targets (promotion_id, catalog_item_id)
  where catalog_item_id is not null;

create index if not exists idx_store_promotions_active_window
  on public.store_promotions (is_active, starts_at, ends_at, priority desc, created_at desc);

create index if not exists idx_store_promotions_window
  on public.store_promotions (starts_at, ends_at);

create index if not exists idx_store_promotion_targets_promotion_id
  on public.store_promotion_targets (promotion_id);

create index if not exists idx_store_promotion_targets_bank_id
  on public.store_promotion_targets (bank_id)
  where bank_id is not null;

create index if not exists idx_store_promotion_targets_catalog_item_id
  on public.store_promotion_targets (catalog_item_id)
  where catalog_item_id is not null;

alter table public.store_promotions enable row level security;
alter table public.store_promotion_targets enable row level security;

drop policy if exists store_promotions_select_admin on public.store_promotions;
drop policy if exists store_promotions_insert_admin on public.store_promotions;
drop policy if exists store_promotions_update_admin on public.store_promotions;
drop policy if exists store_promotions_delete_admin on public.store_promotions;

create policy store_promotions_select_admin
on public.store_promotions
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

create policy store_promotions_insert_admin
on public.store_promotions
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

create policy store_promotions_update_admin
on public.store_promotions
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

create policy store_promotions_delete_admin
on public.store_promotions
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

drop policy if exists store_promotion_targets_select_admin on public.store_promotion_targets;
drop policy if exists store_promotion_targets_insert_admin on public.store_promotion_targets;
drop policy if exists store_promotion_targets_update_admin on public.store_promotion_targets;
drop policy if exists store_promotion_targets_delete_admin on public.store_promotion_targets;

create policy store_promotion_targets_select_admin
on public.store_promotion_targets
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

create policy store_promotion_targets_insert_admin
on public.store_promotion_targets
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

create policy store_promotion_targets_update_admin
on public.store_promotion_targets
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

create policy store_promotion_targets_delete_admin
on public.store_promotion_targets
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

alter table public.bank_purchase_requests
  add column if not exists original_price_php_snapshot numeric(12,2),
  add column if not exists discount_amount_php_snapshot numeric(12,2),
  add column if not exists promotion_snapshot jsonb;

alter table public.bank_purchase_requests
  drop constraint if exists bank_purchase_requests_original_price_php_snapshot_ck;
alter table public.bank_purchase_requests
  add constraint bank_purchase_requests_original_price_php_snapshot_ck
  check (original_price_php_snapshot is null or original_price_php_snapshot >= 0);

alter table public.bank_purchase_requests
  drop constraint if exists bank_purchase_requests_discount_amount_php_snapshot_ck;
alter table public.bank_purchase_requests
  add constraint bank_purchase_requests_discount_amount_php_snapshot_ck
  check (discount_amount_php_snapshot is null or discount_amount_php_snapshot >= 0);

create index if not exists idx_bank_purchase_requests_original_price_snapshot
  on public.bank_purchase_requests (original_price_php_snapshot);

create index if not exists idx_bank_purchase_requests_discount_amount_snapshot
  on public.bank_purchase_requests (discount_amount_php_snapshot);
