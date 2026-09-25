import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fetchNews } from '../services/news'
import { getDbStatus } from '../services/supabase'

// Модалка «Новости»: показывает список опубликованных новостей.
// Каждую новость можно открыть (прочитать) и закрыть. Оверлей — закрыть всё.
import { IconClose } from './Icons'

export default function NewsModal({ onClose }) {
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)

  const db = getDbStatus()

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchNews(10)
      .then(list => { if (active) setNews(list) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  // Открытая новость (для полного чтения)
  const openNews = news.find(n => n.id === openId)

  const closeNews = (e) => {
    e.stopPropagation()
    setOpenId(null)
  }

  const formatDate = (iso) => {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch {
      return ''
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box news-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <span className="modal-title">Новости</span>
          <button className="profile-picker-close news-close" onClick={onClose} title="Закрыть">
            <IconClose size={16} />
          </button>
        </div>

        {!db.enabled && (
          <div className="news-db-closed">
            База данных временно закрыта — новости недоступны.
            {db.reason ? ` Причина: ${db.reason}` : ''}
          </div>
        )}

        {db.enabled && openNews ? (
          <div className="news-article">
            <div className="news-article-back" onClick={closeNews}>← Все новости</div>
            <h3 className="news-article-title">{openNews.title}</h3>
            <span className="news-article-date">{formatDate(openNews.created_at)}</span>
            <div className="news-article-body">{openNews.body}</div>
            <button className="btn btn-sm news-article-close" onClick={() => setOpenId(null)}>Закрыть</button>
          </div>
        ) : (
          <div className="modal-list news-list">
            {loading && <div className="modal-empty">Загрузка новостей...</div>}
            {!loading && !db.enabled && <div className="modal-empty">Новости недоступны</div>}
            {!loading && db.enabled && news.length === 0 && (
              <div className="modal-empty">Новостей пока нет</div>
            )}
            {news.map(n => (
              <button key={n.id} className="modal-row news-row" onClick={() => setOpenId(n.id)}>
                <span className="news-row-info">
                  <span className="modal-row-name news-row-title">{n.title}</span>
                  <span className="news-row-date">{formatDate(n.created_at)}</span>
                </span>
                <span className="modal-row-count news-arrow">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
