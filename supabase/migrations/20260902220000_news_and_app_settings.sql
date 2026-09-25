-- Новости приложения + управление доступностью БД (app_settings).
-- Публикация новостей и открытие/закрытие БД — только владелец через
-- Supabase SQL Editor (service role обходит RLS).

-- 1. Новости
create table if not exists public.news (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  published  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.news enable row level security;

-- Все видят только опубликованные новости
create policy "news_read_published" on public.news
  for select using (published);

-- 2. Управление доступностью БД (одна строка, id = 1)
create table if not exists public.app_settings (
  id         int primary key check (id = 1),
  db_enabled boolean not null default true,
  db_status  text,
  updated_at timestamptz not null default now()
);

-- Флаги включения разделов (v0.2.4): маркет и комнаты
alter table public.app_settings add column if not exists market_enabled boolean not null default true;
alter table public.app_settings add column if not exists rooms_enabled  boolean not null default true;

insert into public.app_settings (id, db_enabled, db_status)
values (1, true, null)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Статус читается всеми; меняет его только владелец (service role)
create policy "app_settings_read" on public.app_settings
  for select using (true);
