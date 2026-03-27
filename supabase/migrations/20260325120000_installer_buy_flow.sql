alter table public.landing_download_config
  add column if not exists buy_sections jsonb not null default '{}'::jsonb;

update public.landing_download_config
set buy_sections = coalesce(nullif(buy_sections, '{}'::jsonb), '{
  "V1": {
    "title": "Buy V1",
    "description": "Register your VDJV V1 account, submit your payment proof, and wait for approval before downloading and logging in.",
    "imageUrl": "/assets/logo.png",
    "defaultInstallerDownloadLink": "",
    "notes": "V1 uses account approval instead of installer licenses."
  },
  "V2": {
    "title": "Buy V2",
    "description": "Includes FREE Android Remote App, iOS sold separately • Easy Windows installer • macOS: contact for compatibility",
    "imageUrl": "/assets/logo.png",
    "defaultInstallerDownloadLink": "https://m.me/vdjvsampler/",
    "notes": "Exact update access depends on the selected SKU."
  },
  "V3": {
    "title": "Buy V3",
    "description": "Includes FREE Android Remote App, iOS sold separately • Easy Windows installer • macOS: contact for compatibility",
    "imageUrl": "/assets/logo.png",
    "defaultInstallerDownloadLink": "https://m.me/vdjvsampler/",
    "notes": "Use the V3 installer after approval."
  }
}'::jsonb)
where id = 'default';

create table if not exists public.installer_buy_products (
  id uuid primary key default gen_random_uuid(),
  version text not null check (version in ('V2', 'V3')),
  sku_code text not null,
  product_type text not null check (product_type in ('standard', 'update', 'promax')),
  display_name text not null,
  description text not null default '',
  price_php numeric(10,2) not null default 0 check (price_php >= 0),
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  allow_auto_approve boolean not null default true,
  hero_image_url text null,
  download_link_override text null,
  granted_entitlements text[] not null default '{}',
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installer_buy_products_sku_ck check (length(btrim(sku_code)) > 0),
  constraint installer_buy_products_name_ck check (length(btrim(display_name)) > 0)
);

create unique index if not exists ux_installer_buy_products_version_sku
  on public.installer_buy_products (version, sku_code);

create index if not exists idx_installer_buy_products_version_sort
  on public.installer_buy_products (version, sort_order, created_at desc);

drop trigger if exists trg_installer_buy_products_updated_at
  on public.installer_buy_products;

create trigger trg_installer_buy_products_updated_at
before update on public.installer_buy_products
for each row execute function public.set_row_updated_at();

alter table public.installer_buy_products enable row level security;
revoke all on table public.installer_buy_products from public, anon, authenticated;

create table if not exists public.installer_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  version text not null check (version in ('V2', 'V3')),
  sku_code text not null,
  product_type text not null check (product_type in ('standard', 'update', 'promax')),
  display_name_snapshot text not null,
  price_php_snapshot numeric(10,2) null check (price_php_snapshot is null or price_php_snapshot >= 0),
  granted_entitlements_snapshot text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  payment_channel text not null
    check (payment_channel in ('image_proof', 'gcash_manual', 'maya_manual')),
  payer_name text null,
  reference_no text null,
  receipt_reference text not null,
  notes text null,
  proof_path text null,
  rejection_message text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  issued_license_id bigint null,
  issued_license_code text null,
  installer_download_link text null,
  decision_email_status text not null default 'pending'
    check (decision_email_status in ('pending', 'sent', 'failed', 'skipped')),
  decision_email_error text null,
  ocr_reference_no text null,
  ocr_payer_name text null,
  ocr_amount_php numeric(10,2) null,
  ocr_recipient_number text null,
  ocr_provider text null,
  ocr_scanned_at timestamptz null,
  ocr_status text null
    check (ocr_status in ('detected', 'missing_reference', 'missing_amount', 'missing_recipient_number', 'failed', 'unavailable', 'skipped')),
  ocr_error_code text null,
  decision_source text null
    check (decision_source in ('manual', 'automation')),
  automation_result text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installer_purchase_proof_path_ck check (
    proof_path is null
    or (
      proof_path like 'installer/%'
      and proof_path ~* '\.(png|jpg|jpeg|webp|gif|heic|heif)$'
    )
  ),
  constraint installer_purchase_reject_reason_ck check (
    status <> 'rejected'
    or (rejection_message is not null and length(btrim(rejection_message)) > 0)
  ),
  constraint installer_purchase_approved_license_ck check (
    status <> 'approved' or issued_license_id is not null
  )
);

create index if not exists idx_installer_purchase_requests_status_created
  on public.installer_purchase_requests (status, created_at desc);

create index if not exists idx_installer_purchase_requests_version_status_created
  on public.installer_purchase_requests (version, status, created_at desc);

create index if not exists idx_installer_purchase_requests_receipt_reference
  on public.installer_purchase_requests (receipt_reference);

create unique index if not exists ux_installer_purchase_pending_email_sku
  on public.installer_purchase_requests (email_normalized, version, sku_code)
  where status = 'pending';

drop trigger if exists trg_installer_purchase_requests_updated_at
  on public.installer_purchase_requests;

create trigger trg_installer_purchase_requests_updated_at
before update on public.installer_purchase_requests
for each row execute function public.set_row_updated_at();

alter table public.installer_purchase_requests enable row level security;
revoke all on table public.installer_purchase_requests from public, anon, authenticated;

alter table public.store_payment_settings
  add column if not exists installer_v2_auto_approve_enabled boolean not null default false,
  add column if not exists installer_v2_auto_approve_mode text not null default 'schedule',
  add column if not exists installer_v2_auto_approve_start_hour smallint not null default 0,
  add column if not exists installer_v2_auto_approve_end_hour smallint not null default 0,
  add column if not exists installer_v2_auto_approve_duration_hours smallint not null default 24,
  add column if not exists installer_v2_auto_approve_expires_at timestamptz null,
  add column if not exists installer_v3_auto_approve_enabled boolean not null default false,
  add column if not exists installer_v3_auto_approve_mode text not null default 'schedule',
  add column if not exists installer_v3_auto_approve_start_hour smallint not null default 0,
  add column if not exists installer_v3_auto_approve_end_hour smallint not null default 0,
  add column if not exists installer_v3_auto_approve_duration_hours smallint not null default 24,
  add column if not exists installer_v3_auto_approve_expires_at timestamptz null;
