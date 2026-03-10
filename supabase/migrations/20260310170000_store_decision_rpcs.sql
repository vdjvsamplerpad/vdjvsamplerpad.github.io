begin;

create or replace function public.claim_payment_reference(
  p_source_reference text,
  p_source_table text,
  p_source_request_id uuid
)
returns table (
  reserved boolean,
  normalized_reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized text;
begin
  if coalesce(length(trim(p_source_reference)), 0) = 0 then
    reserved := false;
    normalized_reference := null;
    return next;
    return;
  end if;

  if p_source_table not in ('account_registration_requests', 'bank_purchase_requests') then
    raise exception 'Invalid source table';
  end if;

  v_normalized := upper(regexp_replace(trim(p_source_reference), '\s+', '', 'g'));

  insert into public.payment_reference_registry (
    normalized_reference,
    source_reference,
    source_table,
    source_request_id
  )
  values (
    v_normalized,
    trim(p_source_reference),
    p_source_table,
    p_source_request_id
  )
  on conflict (normalized_reference) do nothing;

  reserved := found;
  normalized_reference := v_normalized;
  return next;
end;
$$;

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
    select distinct r.user_id, r.bank_id
    from public.bank_purchase_requests r
    where r.id = any(p_request_ids)
      and r.status = 'pending'
      and r.user_id is not null
      and r.bank_id is not null
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
      automation_result = p_automation_result
    where r.id = any(p_request_ids)
      and r.status = 'pending'
    returning r.id
  )
  select updated.id from updated;
end;
$$;

revoke all on function public.claim_payment_reference(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_payment_reference(text, text, uuid) to service_role;

revoke all on function public.apply_store_request_decision(uuid[], text, uuid, timestamp with time zone, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_store_request_decision(uuid[], text, uuid, timestamp with time zone, text, text, text) to service_role;

commit;
