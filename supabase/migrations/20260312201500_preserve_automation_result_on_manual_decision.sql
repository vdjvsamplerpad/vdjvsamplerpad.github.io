begin;

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
