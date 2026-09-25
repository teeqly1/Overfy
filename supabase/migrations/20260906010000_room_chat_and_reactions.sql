-- 2026-09-06: комментарии (живут 10 минут) и эмодзи-реакции в комнатах.
-- Комментарии удаляются автоматически: фильтром при выборке (now() - 10 min),
-- политикой DELETE для «протухших» строк и периодической чисткой из приложения.
-- При закрытии комнаты все комментарии и реакции удаляются создателем.

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

-- Realtime: чтобы комментарии и реакции других участников приходили живыми
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