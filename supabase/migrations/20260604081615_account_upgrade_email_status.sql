alter table if exists public.account_upgrade_requests
  add column if not exists decision_email_status text,
  add column if not exists decision_email_error text,
  add column if not exists pending_email_status text,
  add column if not exists pending_email_error text;

comment on column public.account_upgrade_requests.decision_email_status is
  'Delivery status for the latest account upgrade decision email.';
comment on column public.account_upgrade_requests.decision_email_error is
  'Last delivery error for account upgrade decision email, if any.';
comment on column public.account_upgrade_requests.pending_email_status is
  'Delivery status for the account upgrade pending receipt email.';
comment on column public.account_upgrade_requests.pending_email_error is
  'Last delivery error for account upgrade pending receipt email, if any.';
