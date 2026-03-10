create index if not exists idx_activity_logs_export_phase_created_at
  on public.activity_logs ((meta ->> 'phase'), created_at desc)
  where event_type = 'bank.export';
