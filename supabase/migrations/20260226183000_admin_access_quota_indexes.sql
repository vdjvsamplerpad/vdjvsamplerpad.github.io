begin;

create index if not exists idx_activity_logs_export_upload_result_created_at
  on public.activity_logs (((meta -> 'upload' ->> 'result')), created_at desc)
  where event_type = 'bank.export';

create index if not exists idx_account_registration_requests_status_created_at
  on public.account_registration_requests (status, created_at desc);

create index if not exists idx_user_bank_access_bank_id
  on public.user_bank_access (bank_id);

commit;
