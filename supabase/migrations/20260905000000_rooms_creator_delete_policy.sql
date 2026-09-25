-- Политика: создатель комнаты может удалять участников (выход/закрытие).
-- Без неё leaveRoom/closeRoom создателя удаляли бы только его строку,
-- остальные room_members оставались осиротевшими в БД.
create policy "room_members_delete_creator" on public.room_members
  for delete using (
    exists (
      select 1 from public.rooms
      where rooms.id = room_members.room_id
        and rooms.creator_id = auth.uid()
    )
  );