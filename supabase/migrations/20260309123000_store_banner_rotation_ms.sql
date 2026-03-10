alter table public.store_payment_settings
  add column if not exists banner_rotation_ms integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_payment_settings_banner_rotation_ms_ck'
  ) then
    alter table public.store_payment_settings
      add constraint store_payment_settings_banner_rotation_ms_ck
      check (
        banner_rotation_ms is null
        or (
          banner_rotation_ms >= 3000
          and banner_rotation_ms <= 15000
        )
      );
  end if;
end $$;

update public.store_payment_settings
set banner_rotation_ms = 5000
where banner_rotation_ms is null;
