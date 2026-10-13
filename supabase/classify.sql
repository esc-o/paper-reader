-- Run this once if the first schema is already applied.
-- It adds folders, tags, and the label that ties a paper to one folder.

create table if not exists public.folders (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.tags (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null default '',
  color text not null default 'yellow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.book_labels (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id text not null,
  folder_id text,
  tag_ids jsonb not null default '[]'::jsonb,
  year integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.book_labels enable row level security;

drop policy if exists "folders_own" on public.folders;
drop policy if exists "tags_own" on public.tags;
drop policy if exists "book_labels_own" on public.book_labels;

create policy "folders_own" on public.folders
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tags_own" on public.tags
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "book_labels_own" on public.book_labels
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
