begin;

set local statement_timeout = '120s';

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.store_promotion_targets',
    'public.store_promotions',
    'public.r2_direct_upload_sessions',
    'public.github_direct_upload_sessions',
    'public.user_sampler_metadata_snapshots',
    'public.user_bank_export_snapshots',
    'public.payment_reference_registry',
    'public.bank_purchase_requests',
    'public.account_registration_requests',
    'public.api_rate_limit_counters',
    'public.active_sessions',
    'public.activity_logs',
    'public.bank_catalog_items',
    'public.default_bank_releases'
  ] loop
    if to_regclass(v_table) is not null then
      execute 'delete from ' || v_table;
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.user_bank_access') is not null
     and to_regclass('public.banks') is not null then
    delete from public.user_bank_access
    where bank_id in (
      select id
      from public.banks
      where created_at >= timestamptz '2026-03-01 00:00:00+00'
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.banks') is not null then
    delete from public.banks
    where created_at >= timestamptz '2026-03-01 00:00:00+00';

    update public.banks
    set
      title = case
        when title like 'OLD.%' then title
        else 'OLD.' || title
      end,
      description = 'LEGACY BANK'
    where created_at < timestamptz '2026-03-01 00:00:00+00';
  end if;
end $$;

commit;
