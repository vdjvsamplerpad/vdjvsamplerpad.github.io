set statement_timeout = '60s';

create extension if not exists pgcrypto;

create table if not exists public.account_registration_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  display_name text not null,
  password_ciphertext text null,
  password_iv text null,
  password_key_version smallint not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  payment_channel text not null
    check (payment_channel in ('image_proof', 'gcash_manual', 'maya_manual')),
  payer_name text null,
  reference_no text null,
  notes text null,
  proof_path text null,
  payment_settings_snapshot jsonb not null default '{}'::jsonb,
  rejection_message text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamp with time zone null,
  approved_auth_user_id uuid null references auth.users(id) on delete set null,
  decision_email_status text not null default 'pending'
    check (decision_email_status in ('pending', 'sent', 'failed', 'skipped')),
  decision_email_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint account_reg_proof_path_ck check (
    proof_path is null
    or (
      proof_path like 'registration/%'
      and proof_path ~* '\.(png|jpg|jpeg|webp|gif|heic|heif)$'
    )
  ),
  constraint account_reg_reject_reason_ck check (
    status <> 'rejected'
    or (rejection_message is not null and length(btrim(rejection_message)) > 0)
  ),
  constraint account_reg_approved_user_ck check (
    status <> 'approved' or approved_auth_user_id is not null
  ),
  constraint account_reg_pending_password_ck check (
    (status = 'pending' and password_ciphertext is not null and password_iv is not null)
    or status <> 'pending'
  )
);

create index if not exists idx_account_reg_status_created
  on public.account_registration_requests (status, created_at desc);

create index if not exists idx_account_reg_email_created
  on public.account_registration_requests (email_normalized, created_at desc);

create index if not exists idx_account_reg_reviewed_by
  on public.account_registration_requests (reviewed_by);

create unique index if not exists ux_account_reg_pending_email
  on public.account_registration_requests (email_normalized)
  where status = 'pending';

create unique index if not exists ux_account_reg_approved_email
  on public.account_registration_requests (email_normalized)
  where status = 'approved';

drop trigger if exists trg_account_registration_requests_updated_at
  on public.account_registration_requests;

create trigger trg_account_registration_requests_updated_at
before update on public.account_registration_requests
for each row execute function public.set_row_updated_at();

alter table public.account_registration_requests enable row level security;

revoke all on table public.account_registration_requests from public, anon, authenticated;
