-- Плейлисты: нормализованная схема (одна строка на плейлист).
-- В отличие от прежней модели: user_playlists (JSONB-массив всех плейлистов
-- в одной строке) заменяется таблицей playlists + playlist_tracks.
--
-- playlists.id — это клиентский идентификатор (pl_...), чтобы локальная
-- localStorage и облачная копия всегда совпадали.

-- 1. Таблица плейлистов
create table if not exists public.playlists (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  visibility    text not null default 'private', -- private | public
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists playlists_user_idx on public.playlists (user_id);

-- 2. Таблица треков в плейлистах
create table if not exists public.playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id text not null references public.playlists(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  track_id    text not null,
  position    int  not null default 0,
  name        text not null default '',
  artist_name text not null default '',
  duration    int  not null default 0,
  image       text,
  source      text,
  created_at  timestamptz not null default now(),
  unique (playlist_id, track_id)
);

create index if not exists playlist_tracks_playlist_idx
  on public.playlist_tracks (playlist_id, position);

-- 3. RLS
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;

-- Плейлисты: владелец управляет своими
create policy "playlists_select_own" on public.playlists
  for select using (auth.uid() = user_id);
create policy "playlists_insert_own" on public.playlists
  for insert with check (auth.uid() = user_id);
create policy "playlists_update_own" on public.playlists
  for update using (auth.uid() = user_id);
create policy "playlists_delete_own" on public.playlists
  for delete using (auth.uid() = user_id);
-- Публичные плейлисты видны всем
create policy "playlists_select_public" on public.playlists
  for select using (visibility = 'public');

-- Треки: владелец управляет своими
create policy "playlist_tracks_select_own" on public.playlist_tracks
  for select using (auth.uid() = user_id);
create policy "playlist_tracks_insert_own" on public.playlist_tracks
  for insert with check (auth.uid() = user_id);
create policy "playlist_tracks_update_own" on public.playlist_tracks
  for update using (auth.uid() = user_id);
create policy "playlist_tracks_delete_own" on public.playlist_tracks
  for delete using (auth.uid() = user_id);
-- Публичные треки плейлистов видны всем (если плейлист public)
create policy "playlist_tracks_select_public" on public.playlist_tracks
  for select using (
    exists (
      select 1 from public.playlists pl
      where pl.id = playlist_tracks.playlist_id
        and pl.visibility = 'public'
    )
  );

-- 4. Перенос данных из старой схемы, если она ещё существует.
--    Старая схема: user_playlists(user_id PK, playlists jsonb, visibility) —
--    одна строка на пользователя, каждый элемент массива playlists —
--    отдельный плейлист {id, name, tracks:[...]}.
--    Новые идентификаторы плейлистов берём из JSON-поля id элемента.
do $$
declare
  r record;
  p jsonb;
  uid uuid;
begin
  -- Только если старая таблица существует
  if to_regclass('public.user_playlists') is not null then
    for r in select * from public.user_playlists loop
      for p in select jsonb_array_elements(r.playlists) loop
        uid := r.user_id;

        -- Вставка плейлиста (id из JSON, иначе генерируем pl_...)
        insert into public.playlists (id, user_id, name, visibility, created_at, updated_at)
        values (
          coalesce(p->>'id', 'pl_' || uid::text || '_' || floor(extract(epoch from now()))::text),
          uid,
          coalesce(p->>'name', 'Новый плейлист'),
          coalesce(p->>'visibility', r.visibility, 'private'),
          now(), now()
        )
        on conflict (id) do nothing;

        -- Треки плейлиста из JSON-массива p->'tracks'
        insert into public.playlist_tracks
          (playlist_id, user_id, track_id, position, name, artist_name, duration, image, source)
        select
          coalesce(p->>'id', ''),
          uid,
          coalesce(track->>'id', ''),
          row_number() over () - 1,
          coalesce(track->>'name', ''),
          coalesce(track->>'artist_name', ''),
          coalesce((track->>'duration')::int, 0),
          track->>'image',
          track->>'source'
        from jsonb_array_elements(coalesce(p->'tracks', '[]'::jsonb)) as track
        on conflict (playlist_id, track_id) do nothing;
      end loop;
    end loop;
  end if;
end $$;
