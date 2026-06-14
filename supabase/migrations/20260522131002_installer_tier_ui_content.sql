alter table public.account_registration_requests
  add column if not exists target_tier text not null default 'pro';

do $$
begin
  alter table public.account_registration_requests
    add constraint account_registration_requests_target_tier_ck
    check (target_tier in ('pro', 'pro_max'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.installer_tier_configs (
  id uuid primary key default gen_random_uuid(),
  version text not null check (version in ('V2', 'V3')),
  tier text not null check (tier in ('standard', 'pro', 'pro_max')),
  display_name text not null default '',
  description text not null default '',
  ui_content jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installer_tier_configs_name_ck check (length(btrim(display_name)) > 0),
  constraint installer_tier_configs_unique unique (version, tier)
);

create index if not exists idx_installer_tier_configs_version_tier
  on public.installer_tier_configs (version, tier);

drop trigger if exists trg_installer_tier_configs_updated_at
  on public.installer_tier_configs;

create trigger trg_installer_tier_configs_updated_at
before update on public.installer_tier_configs
for each row execute function public.set_row_updated_at();

alter table public.installer_tier_configs enable row level security;
revoke all on table public.installer_tier_configs from public, anon, authenticated;

insert into public.installer_tier_configs (version, tier, display_name, description, ui_content, is_active)
select version_key, tier_key, display_name, description, ui_content, true
from (
  values
    ('V2', 'standard', 'STANDARD', 'Core V2 installer package.', '{
      "version": 1,
      "color": "#f59e0b",
      "cardHeader": { "enabled": false, "label": "" },
      "versionBadge": { "enabled": true, "label": "V2" },
      "video": { "src": "/assets/v2-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Core V2 installer package."],
      "otherDescriptions": [{ "title": "Core installer", "body": "Base package with license request, receipt review, and download links after approval." }],
      "checklist": ["Base installer package", "License request by email", "Admin receipt review", "Installer links after approval"],
      "meterPercent": 48,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Installer download", "badge": "ENABLED", "enabled": true },
        { "title": "License code", "badge": "ENABLED", "enabled": true },
        { "title": "Update add-ons", "badge": "OPTIONAL", "enabled": false }
      ]
    }'::jsonb),
    ('V2', 'pro', 'PRO', 'Standard plus selected V2 updates, or Update Only for existing Standard users.', '{
      "version": 1,
      "color": "#f21984",
      "cardHeader": { "enabled": true, "label": "Flexible" },
      "versionBadge": { "enabled": true, "label": "V2" },
      "video": { "src": "/assets/v2-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Build PRO from Standard plus selected updates, or choose Update Only if Standard is already installed."],
      "otherDescriptions": [{ "title": "Standard + Update", "body": "Bundle Standard with one or more update packages in one checkout request." }],
      "checklist": ["Choose Standard + Update or Update Only", "Select one or more update SKUs", "Single checkout request", "Better fit for existing users"],
      "meterPercent": 66,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Standard installer", "badge": "INCLUDED", "enabled": true },
        { "title": "Selected updates", "badge": "OPTIONAL", "enabled": false },
        { "title": "License review", "badge": "ENABLED", "enabled": true }
      ]
    }'::jsonb),
    ('V2', 'pro_max', 'PRO MAX', 'Maximum V2 installer package.', '{
      "version": 1,
      "color": "#2155ff",
      "cardHeader": { "enabled": true, "label": "Best value" },
      "versionBadge": { "enabled": true, "label": "V2" },
      "video": { "src": "/assets/v2-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Maximum V2 installer package."],
      "otherDescriptions": [{ "title": "Maximum installer access", "body": "Top package from the Installer Catalog with complete setup and admin-controlled pricing." }],
      "checklist": ["Top package from Installer Catalog", "Best for complete setup", "License and download after approval", "Admin-controlled pricing"],
      "meterPercent": 100,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Full installer package", "badge": "ENABLED", "enabled": true },
        { "title": "Updates", "badge": "INCLUDED", "enabled": true },
        { "title": "License code", "badge": "ENABLED", "enabled": true }
      ]
    }'::jsonb),
    ('V3', 'standard', 'STANDARD', 'Core V3 installer package.', '{
      "version": 1,
      "color": "#f59e0b",
      "cardHeader": { "enabled": false, "label": "" },
      "versionBadge": { "enabled": true, "label": "V3" },
      "video": { "src": "/assets/v3-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Core V3 installer package."],
      "otherDescriptions": [{ "title": "Core installer", "body": "Base package with license request, receipt review, and download links after approval." }],
      "checklist": ["Base installer package", "License request by email", "Admin receipt review", "Installer links after approval"],
      "meterPercent": 48,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Installer download", "badge": "ENABLED", "enabled": true },
        { "title": "License code", "badge": "ENABLED", "enabled": true },
        { "title": "Update add-ons", "badge": "OPTIONAL", "enabled": false }
      ]
    }'::jsonb),
    ('V3', 'pro', 'PRO', 'Standard plus selected V3 updates, or Update Only for existing Standard users.', '{
      "version": 1,
      "color": "#f21984",
      "cardHeader": { "enabled": true, "label": "Flexible" },
      "versionBadge": { "enabled": true, "label": "V3" },
      "video": { "src": "/assets/v3-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Build PRO from Standard plus selected updates, or choose Update Only if Standard is already installed."],
      "otherDescriptions": [{ "title": "Standard + Update", "body": "Bundle Standard with one or more update packages in one checkout request." }],
      "checklist": ["Choose Standard + Update or Update Only", "Select one or more update SKUs", "Single checkout request", "Better fit for existing users"],
      "meterPercent": 66,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Standard installer", "badge": "INCLUDED", "enabled": true },
        { "title": "Selected updates", "badge": "OPTIONAL", "enabled": false },
        { "title": "License review", "badge": "ENABLED", "enabled": true }
      ]
    }'::jsonb),
    ('V3', 'pro_max', 'PRO MAX', 'Maximum V3 installer package.', '{
      "version": 1,
      "color": "#2155ff",
      "cardHeader": { "enabled": true, "label": "Best value" },
      "versionBadge": { "enabled": true, "label": "V3" },
      "video": { "src": "/assets/v3-preview.mp4", "storageProvider": "local" },
      "shortDescriptions": ["Maximum V3 installer package."],
      "otherDescriptions": [{ "title": "Maximum installer access", "body": "Top package from the Installer Catalog with complete setup and admin-controlled pricing." }],
      "checklist": ["Top package from Installer Catalog", "Best for complete setup", "License and download after approval", "Admin-controlled pricing"],
      "meterPercent": 100,
      "inclusionTitle": "Included Tools",
      "inclusions": [
        { "title": "Full installer package", "badge": "ENABLED", "enabled": true },
        { "title": "Updates", "badge": "INCLUDED", "enabled": true },
        { "title": "License code", "badge": "ENABLED", "enabled": true }
      ]
    }'::jsonb)
) as defaults(version_key, tier_key, display_name, description, ui_content)
on conflict (version, tier) do nothing;
