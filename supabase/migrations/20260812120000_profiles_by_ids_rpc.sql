begin;

create or replace function public.profiles_by_ids(
  _ids uuid[]
)
returns setof public.profiles
language sql
stable
set search_path = public
as $$
  select *
  from public.profiles
  where id = any(_ids);
$$;

revoke all on function public.profiles_by_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.profiles_by_ids(uuid[]) to service_role;

commit;
