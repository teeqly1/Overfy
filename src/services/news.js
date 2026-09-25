// Новости приложения. Публикация — через Supabase SQL Editor (service role,
// только владелец). Пользователи только читают опубликованные новости.
//
// INSERT-пример (для владельца, в SQL Editor):
//   insert into public.news (title, body) values ('Заголовок', 'Текст новости');
//
// Когда БД выключена (app_settings.db_enabled = false) — новости не грузим.

import { supabase, isDbEnabled } from './supabase'

// Последние опубликованные новости (новые сверху).
export async function fetchNews(limit = 10) {
  if (!isDbEnabled()) return []
  try {
    const { data, error } = await supabase
      .from('news')
      .select('id, title, body, created_at')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      console.error('news fetch:', error.message)
      return []
    }
    return data || []
  } catch {
    return []
  }
}
