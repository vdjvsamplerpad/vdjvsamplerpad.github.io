begin;

create table if not exists public.auth_client_compatibility_attempts (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  client_version integer not null default 0,
  app_version text null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  constraint auth_client_compatibility_attempts_email_ck
    check (email_normalized = lower(btrim(email_normalized)) and position('@' in email_normalized) > 1),
  constraint auth_client_compatibility_attempts_client_version_ck
    check (client_version >= 0)
);

create index if not exists idx_auth_client_compatibility_attempts_email_expires
  on public.auth_client_compatibility_attempts (email_normalized, expires_at desc);

alter table public.auth_client_compatibility_attempts enable row level security;
revoke all on table public.auth_client_compatibility_attempts from public, anon, authenticated;

create or replace function public.vdjv_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  app_metadata jsonb := coalesce(claims->'app_metadata', '{}'::jsonb);
  auth_method text := replace(coalesce(event->>'authentication_method', ''), '"', '');
  user_id uuid := nullif(event->>'user_id', '')::uuid;
  email text := lower(btrim(coalesce(claims->>'email', '')));
  profile_role text;
  profile_tier text;
  has_profile boolean := false;
  has_tier_client_claim boolean := false;
  has_recent_compatibility_attempt boolean := false;
begin
  if user_id is null then
    return event;
  end if;

  select p.role, coalesce(p.account_tier, 'free'), true
    into profile_role, profile_tier, has_profile
  from public.profiles p
  where p.id = user_id
  limit 1;

  if coalesce(profile_role, 'user') = 'admin' or coalesce(profile_tier, 'free') in ('pro', 'pro_max') then
    app_metadata := jsonb_set(app_metadata, '{vdjv_account_tier}', to_jsonb(coalesce(profile_tier, 'pro')), true);
    claims := jsonb_set(claims, '{app_metadata}', app_metadata, true);
    return jsonb_build_object('claims', claims);
  end if;

  has_tier_client_claim :=
    case
      when coalesce(app_metadata->>'vdjv_tier_client', '') ~ '^\d+$'
        then (app_metadata->>'vdjv_tier_client')::integer >= 1
      else false
    end;

  if auth_method = 'token_refresh' and has_tier_client_claim then
    return event;
  end if;

  -- First-time OAuth may not have a profile yet and cannot be pre-marked because
  -- the user chooses the provider email outside the app. Existing FREE profiles
  -- are still blocked unless the client has a compatibility marker.
  if not coalesce(has_profile, false) and auth_method in ('oauth', 'oauth_provider/authorization_code') then
    return event;
  end if;

  if email <> '' then
    select exists (
      select 1
      from public.auth_client_compatibility_attempts a
      where a.email_normalized = email
        and a.client_version >= 1
        and a.expires_at > timezone('utc', now())
    ) into has_recent_compatibility_attempt;
  end if;

  if has_recent_compatibility_attempt then
    app_metadata := jsonb_set(app_metadata, '{vdjv_tier_client}', '1'::jsonb, true);
    app_metadata := jsonb_set(app_metadata, '{vdjv_account_tier}', '"free"'::jsonb, true);
    claims := jsonb_set(claims, '{app_metadata}', app_metadata, true);
    return jsonb_build_object('claims', claims);
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 426,
      'message', 'Please update VDJV Samplerpad before signing in.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant select on table public.profiles to supabase_auth_admin;
grant select on table public.auth_client_compatibility_attempts to supabase_auth_admin;
grant execute on function public.vdjv_custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.vdjv_custom_access_token_hook(jsonb) from authenticated, anon, public;

commit;
