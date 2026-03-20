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
  on conflict on constraint payment_reference_registry_pkey do nothing;

  reserved := found;
  normalized_reference := v_normalized;
  return next;
end;
$$;

revoke all on function public.claim_payment_reference(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_payment_reference(text, text, uuid) to service_role;

commit;
