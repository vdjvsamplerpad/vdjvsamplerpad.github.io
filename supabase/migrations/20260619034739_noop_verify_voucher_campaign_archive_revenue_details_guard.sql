do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_voucher_campaigns'
      and column_name = 'value_php'
  ) then
    raise exception 'voucher campaign value_php column missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_voucher_redemptions'
      and column_name = 'counts_as_revenue_snapshot'
  ) then
    raise exception 'voucher redemption revenue snapshot column missing';
  end if;
end $$;
