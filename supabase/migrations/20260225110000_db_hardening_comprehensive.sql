-- Comprehensive DB hardening migration
-- Run in Supabase SQL editor (or via migration runner) before deploying API changes.

set statement_timeout = '120s';
set lock_timeout = '15s';

begin;

-- 1) SECURITY: lock function search_path for trigger helper.
create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2) SOFT DELETE SUPPORT FOR BANKS.
alter table public.banks
  add column if not exists deleted_at timestamp with time zone null,
  add column if not exists deleted_by uuid null;

alter table public.banks
  drop constraint if exists banks_deleted_by_fkey;

alter table public.banks
  add constraint banks_deleted_by_fkey
  foreign key (deleted_by) references auth.users (id) on delete set null;

create index if not exists idx_banks_deleted_at on public.banks (deleted_at);

-- 3) PROFILE INTEGRITY + AUTO-BACKFILL.
insert into public.profiles (id, display_name, role, updated_at)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'User'
  ) as display_name,
  'user'::text as role,
  now() as updated_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

update public.profiles
set role = 'user'
where role is null or btrim(role) = '';

alter table public.profiles
  alter column role set default 'user';

alter table public.profiles
  drop constraint if exists profiles_role_ck;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['admin'::text, 'user'::text]));

alter table public.profiles
  alter column role set not null;

create or replace function public.ensure_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );

  insert into public.profiles (id, display_name, role, updated_at)
  values (new.id, v_display_name, 'user', now())
  on conflict (id) do update
  set
    display_name = coalesce(nullif(trim(excluded.display_name), ''), public.profiles.display_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_users_profile_sync on auth.users;

create trigger trg_auth_users_profile_sync
after insert on auth.users
for each row
execute function public.ensure_profile_for_auth_user();

-- 4) USER-BANK ACCESS HARDENING.
delete from public.user_bank_access
where user_id is null or bank_id is null;

delete from public.user_bank_access a
using public.user_bank_access b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.bank_id = b.bank_id;

alter table public.user_bank_access
  alter column user_id set not null,
  alter column bank_id set not null;

alter table public.user_bank_access
  drop constraint if exists user_bank_access_user_id_bank_id_key;

drop index if exists public.user_bank_access_user_id_bank_id_key;

create unique index if not exists ux_user_bank_access_user_bank
  on public.user_bank_access (user_id, bank_id);

-- 5) ACTIVITY LOG NORMALIZATION.
alter table public.activity_logs
  add column if not exists bank_uuid uuid null;

update public.activity_logs l
set bank_uuid = l.bank_id::uuid
where l.bank_uuid is null
  and l.bank_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.banks b
    where b.id = l.bank_id::uuid
  );

alter table public.activity_logs
  drop constraint if exists activity_logs_bank_uuid_fkey;

alter table public.activity_logs
  add constraint activity_logs_bank_uuid_fkey
  foreign key (bank_uuid) references public.banks (id) on delete set null;

create index if not exists idx_activity_logs_bank_uuid_created_at
  on public.activity_logs (bank_uuid, created_at desc);

-- 6) CATALOG PRICE NORMALIZATION.
alter table public.bank_catalog_items
  add column if not exists price_php numeric(12,2) null;

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_items_price_php_nonneg_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_items_price_php_nonneg_ck
  check (price_php is null or price_php >= 0);

update public.bank_catalog_items c
set price_php = parsed.price_value
from (
  select
    id,
    case
      when cleaned ~ '^[0-9]+([.][0-9]+)?$' then cleaned::numeric(12,2)
      else null
    end as price_value
  from (
    select
      id,
      replace(regexp_replace(coalesce(price_label, ''), '[^0-9,.-]', '', 'g'), ',', '') as cleaned
    from public.bank_catalog_items
  ) s
) parsed
where c.id = parsed.id
  and c.price_php is null
  and parsed.price_value is not null;

-- 7) SNAPSHOT IMMUTABILITY FOR PURCHASE REQUESTS.
create or replace function public.prevent_purchase_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_paid_snapshot is distinct from old.is_paid_snapshot
     or new.price_label_snapshot is distinct from old.price_label_snapshot
     or new.price_php_snapshot is distinct from old.price_php_snapshot then
    raise exception 'Snapshot fields are immutable once request is created';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_purchase_snapshot_immutable on public.bank_purchase_requests;

create trigger trg_purchase_snapshot_immutable
before update on public.bank_purchase_requests
for each row
execute function public.prevent_purchase_snapshot_mutation();

-- 8) RLS CONSOLIDATION + INITPLAN TUNING.
alter table public.bank_catalog_items enable row level security;
alter table public.bank_purchase_requests enable row level security;
alter table public.store_payment_settings enable row level security;

drop policy if exists bank_catalog_admin_all on public.bank_catalog_items;
drop policy if exists bank_catalog_select_published on public.bank_catalog_items;
drop policy if exists bank_catalog_select_authenticated on public.bank_catalog_items;
drop policy if exists bank_catalog_insert_admin on public.bank_catalog_items;
drop policy if exists bank_catalog_update_admin on public.bank_catalog_items;
drop policy if exists bank_catalog_delete_admin on public.bank_catalog_items;

create policy bank_catalog_select_authenticated on public.bank_catalog_items
for select to authenticated
using (
  is_published = true
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy bank_catalog_insert_admin on public.bank_catalog_items
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy bank_catalog_update_admin on public.bank_catalog_items
for update to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy bank_catalog_delete_admin on public.bank_catalog_items
for delete to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists purchase_admin_all on public.bank_purchase_requests;
drop policy if exists purchase_insert_own on public.bank_purchase_requests;
drop policy if exists purchase_select_own on public.bank_purchase_requests;
drop policy if exists purchase_select_authenticated on public.bank_purchase_requests;
drop policy if exists purchase_insert_authenticated on public.bank_purchase_requests;
drop policy if exists purchase_update_admin on public.bank_purchase_requests;
drop policy if exists purchase_delete_admin on public.bank_purchase_requests;

create policy purchase_select_authenticated on public.bank_purchase_requests
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy purchase_insert_authenticated on public.bank_purchase_requests
for insert to authenticated
with check (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy purchase_update_admin on public.bank_purchase_requests
for update to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy purchase_delete_admin on public.bank_purchase_requests
for delete to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists payment_settings_admin_write on public.store_payment_settings;
drop policy if exists payment_settings_select_auth on public.store_payment_settings;
drop policy if exists payment_settings_select_authenticated on public.store_payment_settings;
drop policy if exists payment_settings_insert_admin on public.store_payment_settings;
drop policy if exists payment_settings_update_admin on public.store_payment_settings;
drop policy if exists payment_settings_delete_admin on public.store_payment_settings;

create policy payment_settings_select_authenticated on public.store_payment_settings
for select to authenticated
using (true);

create policy payment_settings_insert_admin on public.store_payment_settings
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy payment_settings_update_admin on public.store_payment_settings
for update to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy payment_settings_delete_admin on public.store_payment_settings
for delete to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

commit;
