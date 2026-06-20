alter table public.account_voucher_campaigns
  add column if not exists value_php numeric(12, 2) not null default 0 check (value_php >= 0),
  add column if not exists counts_as_revenue boolean not null default false,
  add column if not exists external_payment_note text,
  add column if not exists archived_at timestamp with time zone,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.account_vouchers
  add column if not exists value_php_snapshot numeric(12, 2) not null default 0 check (value_php_snapshot >= 0),
  add column if not exists counts_as_revenue_snapshot boolean not null default false;

alter table public.account_voucher_redemptions
  add column if not exists value_php_snapshot numeric(12, 2) not null default 0 check (value_php_snapshot >= 0),
  add column if not exists counts_as_revenue_snapshot boolean not null default false;

create index if not exists idx_account_voucher_campaigns_archive
  on public.account_voucher_campaigns (is_active, archived_at, created_at desc);

create index if not exists idx_account_voucher_redemptions_campaign
  on public.account_voucher_redemptions (campaign_id, redeemed_at desc);

create or replace function public.copy_next_account_voucher_code(
  p_campaign_id uuid,
  p_code_hash text,
  p_code_prefix text,
  p_code_suffix text,
  p_admin_user_id uuid
)
returns public.account_vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.account_voucher_campaigns;
  v_voucher public.account_vouchers;
begin
  select *
    into v_campaign
    from public.account_voucher_campaigns
    where id = p_campaign_id
    for update;

  if not found then
    raise exception 'VOUCHER_CAMPAIGN_NOT_FOUND';
  end if;

  if v_campaign.is_active is not true or v_campaign.archived_at is not null then
    raise exception 'CAMPAIGN_INACTIVE';
  end if;

  if v_campaign.expires_at is not null and v_campaign.expires_at <= timezone('utc', now()) then
    raise exception 'CAMPAIGN_EXPIRED';
  end if;

  if v_campaign.reserved_count >= v_campaign.max_codes then
    raise exception 'VOUCHER_LIMIT_REACHED';
  end if;

  insert into public.account_vouchers (
    campaign_id,
    code_hash,
    code_prefix,
    code_suffix,
    target_tier,
    status,
    reserved_for_email,
    reserved_for_user_id,
    copied_by,
    expires_at,
    value_php_snapshot,
    counts_as_revenue_snapshot
  )
  values (
    v_campaign.id,
    p_code_hash,
    p_code_prefix,
    p_code_suffix,
    v_campaign.target_tier,
    'reserved',
    lower(v_campaign.target_email),
    v_campaign.target_user_id,
    p_admin_user_id,
    v_campaign.expires_at,
    case when v_campaign.counts_as_revenue then coalesce(v_campaign.value_php, 0) else 0 end,
    coalesce(v_campaign.counts_as_revenue, false)
  )
  returning * into v_voucher;

  update public.account_voucher_campaigns
  set reserved_count = reserved_count + 1,
      updated_at = timezone('utc', now())
  where id = v_campaign.id;

  return v_voucher;
exception
  when unique_violation then
    raise exception 'VOUCHER_CODE_COLLISION';
end;
$$;

revoke all on function public.copy_next_account_voucher_code(uuid, text, text, text, uuid) from public;
grant execute on function public.copy_next_account_voucher_code(uuid, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
