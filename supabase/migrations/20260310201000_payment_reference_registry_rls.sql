begin;

alter table public.payment_reference_registry enable row level security;

commit;
