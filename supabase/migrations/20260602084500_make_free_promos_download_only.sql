do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_bank_access'
      and column_name = 'access_source'
  ) then
    delete from public.user_bank_access
    where access_source = 'promotion';
  end if;
end $$;
