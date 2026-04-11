begin;

alter table public.bank_catalog_items
  add column if not exists item_type text;

update public.bank_catalog_items
set item_type = 'single_bank'
where item_type is null;

alter table public.bank_catalog_items
  alter column item_type set default 'single_bank';

alter table public.bank_catalog_items
  alter column item_type set not null;

alter table public.bank_catalog_items
  add column if not exists bundle_title text,
  add column if not exists bundle_description text;

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_items_item_type_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_items_item_type_ck
  check (item_type in ('single_bank', 'bank_bundle'));

create table if not exists public.bank_catalog_bundle_items (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.bank_catalog_items(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  created_at timestamp with time zone not null default timezone('utc', now())
);

create unique index if not exists idx_bank_catalog_bundle_items_unique_catalog_bank
  on public.bank_catalog_bundle_items (catalog_item_id, bank_id);

create index if not exists idx_bank_catalog_bundle_items_catalog_position
  on public.bank_catalog_bundle_items (catalog_item_id, position, created_at);

create index if not exists idx_bank_catalog_bundle_items_bank_id
  on public.bank_catalog_bundle_items (bank_id);

alter table public.bank_catalog_bundle_items enable row level security;

drop policy if exists bank_catalog_bundle_items_select_admin on public.bank_catalog_bundle_items;
drop policy if exists bank_catalog_bundle_items_insert_admin on public.bank_catalog_bundle_items;
drop policy if exists bank_catalog_bundle_items_update_admin on public.bank_catalog_bundle_items;
drop policy if exists bank_catalog_bundle_items_delete_admin on public.bank_catalog_bundle_items;

create policy bank_catalog_bundle_items_select_admin on public.bank_catalog_bundle_items
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy bank_catalog_bundle_items_insert_admin on public.bank_catalog_bundle_items
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

create policy bank_catalog_bundle_items_update_admin on public.bank_catalog_bundle_items
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

create policy bank_catalog_bundle_items_delete_admin on public.bank_catalog_bundle_items
for delete to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

alter table public.bank_catalog_items
  drop constraint if exists bank_catalog_publish_fields_ck;

alter table public.bank_catalog_items
  add constraint bank_catalog_publish_fields_ck
  check (
    is_published = false
    or item_type = 'bank_bundle'
    or coming_soon = true
    or (
      file_size_bytes is not null
      and file_size_bytes > 0
      and coalesce(storage_provider, '') = 'r2'
      and coalesce(storage_bucket, '') <> ''
      and coalesce(storage_key, '') <> ''
    )
  );

create or replace function public.apply_store_request_decision(
  p_request_ids uuid[],
  p_next_status text,
  p_reviewed_by uuid,
  p_reviewed_at timestamp with time zone,
  p_rejection_message text,
  p_decision_source text,
  p_automation_result text
)
returns table (
  id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(p_request_ids, 1), 0) = 0 then
    return;
  end if;

  if p_next_status not in ('approved', 'rejected') then
    raise exception 'Invalid next status';
  end if;

  if p_decision_source is not null and p_decision_source not in ('manual', 'automation') then
    raise exception 'Invalid decision source';
  end if;

  if p_next_status = 'approved' then
    insert into public.user_bank_access (user_id, bank_id)
    select distinct
      eligible.user_id,
      eligible.grant_bank_id
    from (
      select
        r.id,
        r.user_id,
        coalesce(bundle_item.bank_id, r.bank_id) as grant_bank_id
      from public.bank_purchase_requests r
      left join public.bank_catalog_items catalog
        on catalog.id = r.catalog_item_id
      left join public.bank_catalog_bundle_items bundle_item
        on bundle_item.catalog_item_id = catalog.id
       and catalog.item_type = 'bank_bundle'
      where r.id = any(p_request_ids)
        and r.status = 'pending'
        and r.user_id is not null
        and (
          r.bank_id is not null
          or bundle_item.bank_id is not null
        )
    ) as eligible
    where eligible.grant_bank_id is not null
    on conflict (user_id, bank_id) do nothing;
  end if;

  return query
  with updated as (
    update public.bank_purchase_requests r
    set
      status = p_next_status,
      reviewed_by = p_reviewed_by,
      reviewed_at = p_reviewed_at,
      rejection_message = case
        when p_next_status = 'rejected' then nullif(trim(coalesce(p_rejection_message, '')), '')
        else null
      end,
      decision_source = p_decision_source,
      automation_result = case
        when p_decision_source = 'manual' and p_automation_result is null then r.automation_result
        else p_automation_result
      end
    where r.id = any(p_request_ids)
      and r.status = 'pending'
    returning r.id
  )
  select updated.id from updated;
end;
$$;

revoke all on function public.apply_store_request_decision(uuid[], text, uuid, timestamp with time zone, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_store_request_decision(uuid[], text, uuid, timestamp with time zone, text, text, text) to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
