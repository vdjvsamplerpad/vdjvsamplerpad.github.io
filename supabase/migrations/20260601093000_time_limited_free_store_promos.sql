begin;

alter table public.user_bank_access
  add column if not exists access_source text not null default 'purchase',
  add column if not exists access_expires_at timestamp with time zone,
  add column if not exists source_purchase_request_id uuid,
  add column if not exists source_promotion_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_bank_access_source_purchase_request_fkey'
  ) then
    alter table public.user_bank_access
      add constraint user_bank_access_source_purchase_request_fkey
      foreign key (source_purchase_request_id)
      references public.bank_purchase_requests(id)
      on delete set null;
  end if;

  if to_regclass('public.store_promotions') is not null and not exists (
    select 1
    from pg_constraint
    where conname = 'user_bank_access_source_promotion_fkey'
  ) then
    alter table public.user_bank_access
      add constraint user_bank_access_source_promotion_fkey
      foreign key (source_promotion_id)
      references public.store_promotions(id)
      on delete set null;
  end if;
end $$;

alter table public.user_bank_access
  drop constraint if exists user_bank_access_access_source_ck;

alter table public.user_bank_access
  add constraint user_bank_access_access_source_ck
  check (access_source in ('purchase', 'admin', 'pro_max', 'promotion'));

create index if not exists idx_user_bank_access_active_expiry
  on public.user_bank_access (user_id, bank_id, access_expires_at);

create index if not exists idx_user_bank_access_expiring_promos
  on public.user_bank_access (access_expires_at)
  where access_source = 'promotion' and access_expires_at is not null;

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
    insert into public.user_bank_access (
      user_id,
      bank_id,
      access_source,
      access_expires_at,
      source_purchase_request_id,
      source_promotion_id
    )
    select distinct
      eligible.user_id,
      eligible.grant_bank_id,
      case when eligible.is_free_promotion then 'promotion' else 'purchase' end,
      case when eligible.is_free_promotion then eligible.promotion_ends_at else null end,
      eligible.id,
      eligible.promotion_id
    from (
      select
        r.id,
        r.user_id,
        coalesce(bundle_item.bank_id, r.bank_id) as grant_bank_id,
        (
          coalesce(r.promotion_snapshot ->> 'discount_type', '') = 'free'
          and coalesce((r.promotion_snapshot ->> 'final_price_php')::numeric, -1) = 0
        ) as is_free_promotion,
        nullif(r.promotion_snapshot ->> 'ends_at', '')::timestamp with time zone as promotion_ends_at,
        nullif(r.promotion_snapshot ->> 'id', '')::uuid as promotion_id
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
      and (
        eligible.is_free_promotion = false
        or eligible.promotion_ends_at > timezone('utc', now())
      )
    on conflict (user_id, bank_id) do update
    set
      access_source = case
        when public.user_bank_access.access_expires_at is null then public.user_bank_access.access_source
        when excluded.access_expires_at is null then excluded.access_source
        when excluded.access_expires_at > public.user_bank_access.access_expires_at then excluded.access_source
        else public.user_bank_access.access_source
      end,
      access_expires_at = case
        when public.user_bank_access.access_expires_at is null then null
        when excluded.access_expires_at is null then null
        when excluded.access_expires_at > public.user_bank_access.access_expires_at then excluded.access_expires_at
        else public.user_bank_access.access_expires_at
      end,
      source_purchase_request_id = case
        when public.user_bank_access.access_expires_at is null then public.user_bank_access.source_purchase_request_id
        when excluded.access_expires_at is null then excluded.source_purchase_request_id
        when excluded.access_expires_at > public.user_bank_access.access_expires_at then excluded.source_purchase_request_id
        else public.user_bank_access.source_purchase_request_id
      end,
      source_promotion_id = case
        when public.user_bank_access.access_expires_at is null then public.user_bank_access.source_promotion_id
        when excluded.access_expires_at is null then excluded.source_promotion_id
        when excluded.access_expires_at > public.user_bank_access.access_expires_at then excluded.source_promotion_id
        else public.user_bank_access.source_promotion_id
      end;
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

commit;
