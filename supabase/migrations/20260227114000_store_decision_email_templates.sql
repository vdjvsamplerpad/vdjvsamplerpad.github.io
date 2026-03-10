begin;

alter table public.store_payment_settings
  add column if not exists store_email_approve_subject text null,
  add column if not exists store_email_approve_body text null,
  add column if not exists store_email_reject_subject text null,
  add column if not exists store_email_reject_body text null;

alter table public.bank_purchase_requests
  add column if not exists decision_email_status text null,
  add column if not exists decision_email_error text null;

update public.bank_purchase_requests
set decision_email_status = 'pending'
where decision_email_status is null
   or decision_email_status not in ('pending', 'sent', 'failed', 'skipped');

alter table public.bank_purchase_requests
  alter column decision_email_status set default 'pending';

alter table public.bank_purchase_requests
  alter column decision_email_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bank_purchase_requests_decision_email_status_ck'
  ) then
    alter table public.bank_purchase_requests
      add constraint bank_purchase_requests_decision_email_status_ck
      check (decision_email_status in ('pending', 'sent', 'failed', 'skipped'));
  end if;
end;
$$;

create index if not exists idx_bank_purchase_requests_decision_email_status
  on public.bank_purchase_requests (decision_email_status);

commit;
