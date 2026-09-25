-- Все таблицы Overfy для синхронизации пользовательских данных.
-- Выполнить в Supabase Dashboard → SQL Editor.
-- Фоны приложения намеренно не синхронизируются.
--
-- Полный список таблиц (все в схеме public):
--   profiles         — профиль: ник, аватар, любимые треки
--   friendships      — заявки в друзья и дружба
--   favorites        — избранные треки (user_id, track_id)
--   play_history     — история прослушиваний
--   listening_time   — часы прослушивания (строка на пользователя)
--   playlists        — плейлисты (одна строка на плейлист, visibility private/public)
--   playlist_tracks  — треки в плейлистах (привязаны к playlist_id)
--   imported_tracks  — импортированные локальные треки (jsonb)

-- Часы прослушивания (одна строка на пользователя)
create table if not exists listening_time (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seconds bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Плейлисты: одна строка на каждый плейлист.
-- id — клиентский идентификатор (pl_...), чтобы обычная localStorage
-- и облачная копия всегда совпадали.
create table if not exists playlists (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  visibility    text not null default 'private', -- private | public
  cover         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists playlists_user_idx on playlists (user_id);

-- Треки в плейлистах (нормализованная связь с плейлистом)
create table if not exists playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id text not null references playlists(id) on delete cascade,
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
  on playlist_tracks (playlist_id, position);

-- Импортированные локальные треки (пути и метаданные)
create table if not exists imported_tracks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tracks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: каждый пользователь видит и меняет свои строки
alter table listening_time enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
alter table imported_tracks enable row level security;

create policy "listening_time_select_own" on listening_time
  for select using (auth.uid() = user_id);
create policy "listening_time_modify_own" on listening_time
  for insert with check (auth.uid() = user_id);
create policy "listening_time_update_own" on listening_time
  for update using (auth.uid() = user_id);

-- Плейлисты: владелец управляет своими
create policy "playlists_select_own" on playlists
  for select using (auth.uid() = user_id);
create policy "playlists_insert_own" on playlists
  for insert with check (auth.uid() = user_id);
create policy "playlists_update_own" on playlists
  for update using (auth.uid() = user_id);
create policy "playlists_delete_own" on playlists
  for delete using (auth.uid() = user_id);
-- Публичные плейлисты видны всем
create policy "playlists_select_public" on playlists
  for select using (visibility = 'public');

-- Треки плейлистов: владелец управляет своими
create policy "playlist_tracks_select_own" on playlist_tracks
  for select using (auth.uid() = user_id);
create policy "playlist_tracks_insert_own" on playlist_tracks
  for insert with check (auth.uid() = user_id);
create policy "playlist_tracks_update_own" on playlist_tracks
  for update using (auth.uid() = user_id);
create policy "playlist_tracks_delete_own" on playlist_tracks
  for delete using (auth.uid() = user_id);
-- Публичные треки плейлистов видны всем (если плейлист public)
create policy "playlist_tracks_select_public" on playlist_tracks
  for select using (
    exists (
      select 1 from playlists pl
      where pl.id = playlist_tracks.playlist_id
        and pl.visibility = 'public'
    )
  );

create policy "imported_tracks_select_own" on imported_tracks
  for select using (auth.uid() = user_id);
create policy "imported_tracks_modify_own" on imported_tracks
  for insert with check (auth.uid() = user_id);
create policy "imported_tracks_update_own" on imported_tracks
  for update using (auth.uid() = user_id);

-- ============================================================
-- Профили и друзья (v0.2.2). Тоже выполнить в SQL Editor.
-- ============================================================

-- Публичный профиль: ник, аватар (data URL), до 3 любимых песен
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  nickname_lower text not null,
  avatar text,
  favorite_tracks jsonb not null default '[]'::jsonb,
  is_verified   boolean not null default false,
  is_supporter  boolean not null default false,
  is_developer  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Уникальные ники (без учёта регистра)
create unique index if not exists profiles_nickname_lower_idx on profiles(nickname_lower);

-- Страховка: даже если приложение забудет передать nickname, NOT NULL
-- не сработает — ник заполнится уникальным значением по умолчанию.
alter table profiles alter column nickname set default
  'User_' || substr(gen_random_uuid()::text, 1, 8);
alter table profiles alter column nickname_lower set default
  'user_' || substr(gen_random_uuid()::text, 1, 8);

-- Заявки в друзья и дружба
create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending', -- pending | accepted
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

alter table profiles enable row level security;
alter table friendships enable row level security;

-- Профили публичны для чтения (нужен поиск людей и просмотр профилей друзей)
create policy "profiles_select_all" on profiles
  for select using (true);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- Дружба видна обоим участникам
create policy "friendships_select_participant" on friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
-- Заявку отправляет сам проситель
create policy "friendships_insert_requester" on friendships
  for insert with check (auth.uid() = requester_id and requester_id <> addressee_id);
-- Принять/отклонить может только получатель
create policy "friendships_update_addressee" on friendships
  for update using (auth.uid() = addressee_id);
-- Удалить может любой из участников
create policy "friendships_delete_participant" on friendships
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ============================================================
-- Избранное и история прослушиваний (PlayerContext).
-- ============================================================

create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create table if not exists play_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  listened_at timestamptz not null default now(),
  unique (user_id, track_id)
);

alter table favorites enable row level security;
alter table play_history enable row level security;

create policy "favorites_select_own" on favorites
  for select using (auth.uid() = user_id);
create policy "favorites_insert_own" on favorites
  for insert with check (auth.uid() = user_id);
create policy "favorites_update_own" on favorites
  for update using (auth.uid() = user_id);
create policy "favorites_delete_own" on favorites
  for delete using (auth.uid() = user_id);

create policy "play_history_select_own" on play_history
  for select using (auth.uid() = user_id);
create policy "play_history_insert_own" on play_history
  for insert with check (auth.uid() = user_id);
create policy "play_history_update_own" on play_history
  for update using (auth.uid() = user_id);
create policy "play_history_delete_own" on play_history
  for delete using (auth.uid() = user_id);

-- ============================================================
-- Новости приложения.
-- Публикует ТОЛЬКО владелец через Supabase SQL Editor (service role
-- обходит RLS). Обычные пользователи только читают опубликованное.
--   insert into public.news (title, body) values ('Заголовок', 'Текст');
-- ============================================================

create table if not exists news (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  published  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table news enable row level security;

-- Все видят только опубликованные новости
create policy "news_read_published" on news
  for select using (published);

-- ============================================================
-- Управление доступностью БД (одна строка, id = 1).
-- Владелец открывает/закрывает БД через Supabase SQL Editor:
--   закрыть: update public.app_settings set db_enabled = false,
--            db_status = 'причина', updated_at = now() where id = 1;
--   открыть: update public.app_settings set db_enabled = true,
--            db_status = null, updated_at = now() where id = 1;
-- Когда БД выключена — приложение не ходит в наши таблицы, но
-- SoundCloud/Deezer/Яндекс продолжают работать.
-- ============================================================

create table if not exists app_settings (
  id         int primary key check (id = 1),
  db_enabled boolean not null default true,
  db_status  text,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, db_enabled, db_status)
values (1, true, null)
on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Статус должен читаться всеми (по нему приложение понимает, что БД закрыта).
-- Меняет поле только владелец (service role через SQL Editor, RLS обходится).
create policy "app_settings_read" on app_settings
  for select using (true);

-- ============================================================
-- Колонки обновлений в app_settings (v0.2.3):
--   update_version   — новая версия, напр. '0.3.0'
--   update_changelog — что изменилось (текст для окна «Обновление приложения»)
--   update_url       — прямая ссылка на установщик в Supabase Storage
-- Публикуется владельцем через SQL Editor. Пример:
--   update public.app_settings
--   set update_version = '0.3.0',
--       update_changelog = '• Новый Маркет\n• Частицы на фоне',
--       update_url = 'https://<project>.supabase.co/storage/v1/object/public/updates/Overfy-0.3.0-setup.exe'
--   where id = 1;
-- ============================================================

alter table app_settings add column if not exists update_version text;
alter table app_settings add column if not exists update_changelog text;
alter table app_settings add column if not exists update_url text;

-- Флаги включения разделов (v0.2.4):
--   market_enabled — показывать «Маркет» в навигации (default true)
--   rooms_enabled  — показывать «Комнаты» в навигации (default true)
-- Включение/выключение через SQL Editor:
--   update public.app_settings set market_enabled = false where id = 1;
--   update public.app_settings set rooms_enabled  = false where id = 1;
alter table app_settings add column if not exists market_enabled boolean not null default true;
alter table app_settings add column if not exists rooms_enabled  boolean not null default true;
update app_settings set market_enabled = true, rooms_enabled = true where id = 1 and (market_enabled is null or rooms_enabled is null);

-- ============================================================
-- Маркет: баннеры и прочие предметы оформления профиля.
-- Контент загружает владелец через Supabase Dashboard (public bucket),
-- пользователи просто читают готовые «товары».
-- ============================================================

create table if not exists market_items (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'banner', -- banner
  name        text not null,
  description text,
  image       text,       -- data URL или URL из Storage
  price       int  not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table market_items enable row level security;

create policy "market_items_read_published" on market_items
  for select using (published);

-- ============================================================
-- Бейджи профилей (v0.2.4):
--   is_verified  — ✅ верифицированный пользователь
--   is_supporter — 😊 поддержал проект
--   is_developer — 🛡 разработчик
-- Управление через SQL Editor:
--   update profiles set is_verified = true  where id = '<uuid>';
--   update profiles set is_supporter = true where id = '<uuid>';
--   update profiles set is_developer = true where id = '<uuid>';
-- ============================================================
alter table profiles add column if not exists is_verified  boolean not null default false;
alter table profiles add column if not exists is_supporter boolean not null default false;
alter table profiles add column if not exists is_developer boolean not null default false;

-- ============================================================
-- Комнаты совместного прослушивания (v0.2.4)
-- ============================================================

create table if not exists rooms (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  is_active        boolean not null default true,
  current_track_id text,
  current_position numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

alter table rooms enable row level security;

-- Все авторизованные видят активные комнаты (для поиска/списка)
create policy "rooms_select_active" on rooms
  for select using (auth.role() = 'authenticated' and is_active = true);

-- Создатель может вставлять комнаты
create policy "rooms_insert_own" on rooms
  for insert with check (auth.uid() = creator_id);

-- Создатель может обновлять свою комнату (включая закрытие)
create policy "rooms_update_own" on rooms
  for update using (auth.uid() = creator_id);

-- ============================================================
-- Участники комнат
-- ============================================================

create table if not exists room_members (
  room_id   uuid not null references rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table room_members enable row level security;

-- Участники видят записи в своих комнатах
create policy "room_members_select" on room_members
  for select using (auth.role() = 'authenticated');

-- Любой авторизованный может присоединиться
create policy "room_members_insert" on room_members
  for insert with check (auth.uid() = user_id);

-- Участник может удалить себя (выйти)
create policy "room_members_delete_own" on room_members
  for delete using (auth.uid() = user_id);

-- Создатель комнаты может удалить любые записи участников
-- (закрытие комнаты / выход создателя убирает всех участников)
create policy "room_members_delete_creator" on room_members
  for delete using (
    exists (
      select 1 from rooms
      where rooms.id = room_members.room_id
        and rooms.creator_id = auth.uid()
    )
  );

-- ============================================================
-- Комментарии в комнатах (живут 10 минут) и эмодзи-реакции (v0.3.3)
-- ============================================================

create table if not exists room_comments (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists room_comments_room_created_idx
  on room_comments (room_id, created_at);

alter table room_comments enable row level security;

-- Видят только участники комнаты и её создатель
create policy "room_comments_select" on room_comments
  for select using (
    exists (
      select 1 from room_members
      where room_members.room_id = room_comments.room_id
        and room_members.user_id = auth.uid()
    )
    or exists (
      select 1 from rooms
      where rooms.id = room_comments.room_id
        and rooms.creator_id = auth.uid()
    )
  );

-- Писать можно только от своего имени, будучи участником комнаты
create policy "room_comments_insert" on room_comments
  for insert with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from room_members
        where room_members.room_id = room_comments.room_id
          and room_members.user_id = auth.uid()
      )
      or exists (
        select 1 from rooms
        where rooms.id = room_comments.room_id
          and rooms.creator_id = auth.uid()
      )
    )
  );

-- Удаление: свои, любые «протухшие» (> 10 минут) — для автоочистки,
-- либо любые создателем (полная очистка при закрытии комнаты)
create policy "room_comments_delete" on room_comments
  for delete using (
    auth.uid() = user_id
    or created_at < now() - interval '10 minutes'
    or exists (
      select 1 from rooms
      where rooms.id = room_comments.room_id
        and rooms.creator_id = auth.uid()
    )
  );

create table if not exists room_reactions (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now()
);

create index if not exists room_reactions_room_created_idx
  on room_reactions (room_id, created_at);

alter table room_reactions enable row level security;

create policy "room_reactions_select" on room_reactions
  for select using (
    exists (
      select 1 from room_members
      where room_members.room_id = room_reactions.room_id
        and room_members.user_id = auth.uid()
    )
    or exists (
      select 1 from rooms
      where rooms.id = room_reactions.room_id
        and rooms.creator_id = auth.uid()
    )
  );

create policy "room_reactions_insert" on room_reactions
  for insert with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from room_members
        where room_members.room_id = room_reactions.room_id
          and room_members.user_id = auth.uid()
      )
      or exists (
        select 1 from rooms
        where rooms.id = room_reactions.room_id
          and rooms.creator_id = auth.uid()
      )
    )
  );

-- Удаление: свои, устаревшие (> 10 минут — чистка), либо создателем
create policy "room_reactions_delete" on room_reactions
  for delete using (
    auth.uid() = user_id
    or created_at < now() - interval '10 minutes'
    or exists (
      select 1 from rooms
      where rooms.id = room_reactions.room_id
        and rooms.creator_id = auth.uid()
    )
  );

-- Realtime: комментарии/реакции других участников приходят живыми
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.room_comments, public.room_reactions';
    exception when others then
      raise notice 'room tables already in supabase_realtime publication';
    end;
  end if;
end $$;
