-- Создание таблиц для Overfy

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  created_at timestamptz default now(),
  unique (user_id, track_id)
);

create table if not exists public.play_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  listened_at timestamptz default now(),
  unique (user_id, track_id)
);

-- Row Level Security
alter table public.favorites enable row level security;
alter table public.play_history enable row level security;

-- Политики для favorites
create policy "Users manage own favorites"
  on public.favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Политики для play_history
create policy "Users manage own history"
  on public.play_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
