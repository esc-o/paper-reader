-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- It stores reading progress, notes, settings, and reading time.
-- PDF bytes are not stored.

create table if not exists public.books (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  file_name text not null default '',
  title text not null default '',
  author text not null default '',
  description text not null default '',
  num_pages integer not null default 0,
  current_page integer not null default 1,
  last_read_at timestamptz,
  page_offset integer not null default 0,
  toc jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.annotations (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  book_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.reader_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_time (
  user_id uuid not null references auth.users (id) on delete cascade,
  date text not null,
  seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.books enable row level security;
alter table public.annotations enable row level security;
alter table public.reader_settings enable row level security;
alter table public.reading_time enable row level security;

create policy "books_own" on public.books
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "annotations_own" on public.annotations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "settings_own" on public.reader_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reading_time_own" on public.reading_time
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
