create table if not exists public.legal_documents (
  document_key text not null check (document_key in ('privacy', 'terms')),
  status text not null check (status in ('draft', 'published')),
  title text not null,
  intro text not null,
  sections jsonb not null default '[]'::jsonb,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz null,
  primary key (document_key, status)
);

create table if not exists public.legal_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_key text not null check (document_key in ('privacy', 'terms')),
  status text not null check (status in ('draft', 'published')),
  title text not null,
  intro text not null,
  sections jsonb not null default '[]'::jsonb,
  edited_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists legal_document_revisions_document_key_created_at_idx
  on public.legal_document_revisions (document_key, created_at desc);

alter table public.legal_documents enable row level security;
alter table public.legal_document_revisions enable row level security;

drop policy if exists "legal_documents_deny_direct_access" on public.legal_documents;
create policy "legal_documents_deny_direct_access"
  on public.legal_documents
  for all
  using (false)
  with check (false);

drop policy if exists "legal_document_revisions_deny_direct_access" on public.legal_document_revisions;
create policy "legal_document_revisions_deny_direct_access"
  on public.legal_document_revisions
  for all
  using (false)
  with check (false);
