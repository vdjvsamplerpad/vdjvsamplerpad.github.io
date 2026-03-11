begin;

set local statement_timeout = '60s';

drop policy if exists account_registration_requests_deny_all on public.account_registration_requests;
create policy account_registration_requests_deny_all
on public.account_registration_requests
for all
using (false)
with check (false);

drop policy if exists api_rate_limit_counters_deny_all on public.api_rate_limit_counters;
create policy api_rate_limit_counters_deny_all
on public.api_rate_limit_counters
for all
using (false)
with check (false);

drop policy if exists landing_download_config_deny_all on public.landing_download_config;
create policy landing_download_config_deny_all
on public.landing_download_config
for all
using (false)
with check (false);

drop policy if exists payment_reference_registry_deny_all on public.payment_reference_registry;
create policy payment_reference_registry_deny_all
on public.payment_reference_registry
for all
using (false)
with check (false);

create index if not exists idx_account_registration_requests_approved_auth_user_id
  on public.account_registration_requests (approved_auth_user_id);

create index if not exists idx_default_bank_releases_published_by
  on public.default_bank_releases (published_by);

create index if not exists idx_default_bank_releases_deactivated_by
  on public.default_bank_releases (deactivated_by);

create index if not exists idx_landing_download_config_updated_by
  on public.landing_download_config (updated_by);

create index if not exists idx_r2_direct_upload_sessions_bank_id
  on public.r2_direct_upload_sessions (bank_id);

create index if not exists idx_store_marketing_banners_created_by
  on public.store_marketing_banners (created_by);

create index if not exists idx_store_marketing_banners_updated_by
  on public.store_marketing_banners (updated_by);

create index if not exists idx_store_promotions_created_by
  on public.store_promotions (created_by);

create index if not exists idx_store_promotions_updated_by
  on public.store_promotions (updated_by);

commit;
