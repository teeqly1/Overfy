import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError } from '../services/soundcloud'
import { rememberRemoteTrack } from '../services/remoteTracks'
import { getUserPublicPlaylists } from '../services/userData'
import UserBadges from '../components/UserBadges'
import {
  loadFriendsData, searchUsers, sendFriendRequest,
  acceptFriendRequest, removeFriendship, getRelationTo, getProfileById,
} from '../services/profile'
import { IconClose, IconMusic } from '../components/Icons'

export default function UsersPage() {
  const { user, isGuest } = useAuth()
  const { playTrackAt } = usePlayer()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [viewProfile, setViewProfile] = useState(null)
  const flashTimerRef = useRef(null)

  const flash = (msg) => {
    setNotice(msg)
    clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setNotice(''), 2500)
  }

  const refresh = useCallback(async () => {
    try {
      const d = await loadFriendsData()
      setData(d)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    if (isGuest || !user) return
    refresh()
  }, [user, isGuest, refresh])

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    let active = true
    setSearching(true)
    const t = setTimeout(() => {
      searchUsers(query)
        .then((list) => active && setResults(list))
        .catch((e) => { if (active) { setResults([]); flash(e.message) } })
        .finally(() => active && setSearching(false))
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [query])

  const handleAdd = async (target) => {
    try {
      const res = await sendFriendRequest(target.id)
      if (res.status === 'accepted') flash(`Вы теперь друзья с ${target.nickname}`)
      else if (res.status === 'already-friends') flash('Вы уже друзья')
      else if (res.status === 'already-sent') flash('Заявка уже отправлена')
      else flash('Заявка отправлена')
      refresh()
      if (results) {
        setResults(prev => prev.map(p => p.id === target.id
          ? { ...p, relation: (res.status === 'accepted' || res.status === 'already-friends') ? 'friends' : 'outgoing' }
          : p))
      }
    } catch (e) {
      flash(e.message)
    }
  }

  const handleAccept = async (requestId) => {
    try {
      await acceptFriendRequest(requestId)
      flash('Заявка принята')
      refresh()
    } catch (e) {
      flash(e.message)
    }
  }

  const handleRemove = async (requestId, msg) => {
    try {
      await removeFriendship(requestId)
      flash(msg || 'Удалено')
      refresh()
      setViewProfile(null)
    } catch (e) {
      flash(e.message)
    }
  }

  const openProfile = async (p) => {
    try {
      const relation = await getRelationTo(p.id)
      const full = await getProfileById(p.id)
      setViewProfile({ profile: { ...p, ...(full || {}), relation: relation.status, requestId: relation.requestId } })
    } catch (e) {
      flash(e.message)
    }
  }

  if (isGuest || !user) {
    return (
      <div className="screen users-screen">
        <h2 className="screen-title">Пользователи</h2>
        <div className="empty-state">
          <p>Доступно только с аккаунтом</p>
          <p className="empty-hint">Войдите или зарегистрируйтесь, чтобы искать людей</p>
        </div>
      </div>
    )
  }

  const userRow = (p, actions, onClick) => (
    <div key={p.id} className="user-card" onClick={onClick}>
      <img
        className="user-card-avatar"
        src={p.avatar || initialCover(p.nickname)}
        alt=""
        onError={(e) => handleCoverError(e, { name: p.nickname })}
      />
      <span className="user-card-name">
        {p.nickname}
        <UserBadges profile={p} size={14} />
      </span>
      <div className="user-card-actions" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  )

  const addBtn = (p) => {
    const rel = p.relation || 'none'
    if (rel === 'friends') return <button className="btn btn-outline btn-sm" disabled>Друзья</button>
    if (rel === 'outgoing') return <button className="btn btn-outline btn-sm" disabled>Заявка</button>
    if (rel === 'incoming') return <button className="btn btn-sm" onClick={() => handleAdd(p)}>Принять</button>
    return <button className="btn btn-sm" onClick={() => handleAdd(p)}>+ В друзья</button>
  }

  return (
    <div className="screen users-screen users-layout">
      {/* Левая панель: поиск + результаты */}
      <div className="users-left">
        <h2 className="screen-title">Пользователи</h2>

        <form className="search-bar" onSubmit={(e) => e.preventDefault()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти людей по нику..."
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} title="Очистить">
              <IconClose size={13} />
            </button>
          )}
        </form>

        {error && (
          <div className="empty-state">
            <p>Ошибка</p>
            <p className="empty-hint">{error}</p>
          </div>
        )}

        {/* Результаты поиска */}
        {results !== null && (
          <section className="users-section">
            <h3 className="users-section-title">Результаты поиска</h3>
            {searching ? (
              <div className="profile-loading"><span className="btn-spinner"></span></div>
            ) : results.length ? (
              <div className="users-list">
                {results.map(p => userRow(p, addBtn(p), () => openProfile(p)))}
              </div>
            ) : (
              <p className="empty-hint">Никого не найдено по «{query}»</p>
            )}
          </section>
        )}

        {/* Входящие заявки */}
        {results === null && data?.incoming?.length > 0 && (
          <section className="users-section">
            <h3 className="users-section-title">Заявки в друзья ({data.incoming.length})</h3>
            <div className="users-list">
              {data.incoming.map(({ requestId, profile: p }) => userRow(p, (
                <>
                  <button className="btn btn-sm" onClick={() => handleAccept(requestId)}>Принять</button>
                  <button className="btn btn-outline btn-sm" onClick={() => handleRemove(requestId, 'Заявка отклонена')}>Отклонить</button>
                </>
              ), () => openProfile(p)))}
            </div>
          </section>
        )}

        {/* Исходящие заявки */}
        {results === null && data?.outgoing?.length > 0 && (
          <section className="users-section">
            <h3 className="users-section-title">Отправленные заявки ({data.outgoing.length})</h3>
            <div className="users-list">
              {data.outgoing.map(({ requestId, profile: p }) => userRow(p, (
                <button className="btn btn-outline btn-sm" onClick={() => handleRemove(requestId, 'Заявка отменена')}>Отменить</button>
              ), () => openProfile(p)))}
            </div>
          </section>
        )}

        {results === null && !data && (
          <div className="profile-loading"><span className="btn-spinner"></span></div>
        )}
      </div>

      {/* Правая панель: друзья */}
      <div className="users-right">
        <h3 className="users-right-title">Мои друзья {data ? `(${data.friends.length})` : ''}</h3>
        {!data ? (
          <div className="profile-loading"><span className="btn-spinner"></span></div>
        ) : data.friends.length ? (
          <div className="users-list">
            {data.friends.map(p => userRow(p, (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  if (p.requestId) handleRemove(p.requestId, 'Удалён из друзей')
                }}
                title={p.requestId ? 'Удалить из друзей' : ''}
              >Удалить</button>
            ), () => openProfile(p)))}
          </div>
        ) : (
          <p className="empty-hint">Пока никого — найдите через поиск</p>
        )}
      </div>

      {notice && <div className="profile-notice">{notice}</div>}

      {viewProfile && (
        <UserProfileModal
          data={viewProfile.profile}
          onPlay={playTrackAt}
          onRemove={handleRemove}
          onAdd={handleAdd}
          onClose={() => setViewProfile(null)}
        />
      )}
    </div>
  )
}

function UserProfileModal({ data, onPlay, onRemove, onAdd, onClose }) {
  const favs = data.favorite_tracks || []
  const rel = data.relation || 'none'
  const [publicPlaylists, setPublicPlaylists] = useState([])
  const [loadingPl, setLoadingPl] = useState(true)

  useEffect(() => {
    if (!data?.id) return
    let active = true
    getUserPublicPlaylists(data.id)
      .then(pls => { if (active) setPublicPlaylists(pls) })
      .catch(() => {})
      .finally(() => { if (active) setLoadingPl(false) })
    return () => { active = false }
  }, [data?.id])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box friend-profile" onClick={(e) => e.stopPropagation()}>
        <div className="friend-profile-head">
          <img
            className="profile-avatar"
            src={data.avatar || initialCover(data.nickname)}
            alt=""
            onError={(e) => handleCoverError(e, { name: data.nickname })}
          />
          <div>
            <span className="modal-title">
              {data.nickname}
              <UserBadges profile={data} size={16} />
            </span>
            <span className="friend-rel">
              {rel === 'friends' ? 'У вас в друзьях' : rel === 'outgoing' ? 'Заявка отправлена' : rel === 'incoming' ? 'Хочет добавиться' : ''}
            </span>
          </div>
          <button className="profile-picker-close" onClick={onClose} title="Закрыть">
            <IconClose size={16} />
          </button>
        </div>

        <div className="friend-profile-actions">
          {rel === 'none' && <button className="btn btn-sm" onClick={() => onAdd(data)}>+ В друзья</button>}
          {rel === 'incoming' && <button className="btn btn-sm" onClick={() => onAdd(data)}>Принять заявку</button>}
          {(rel === 'friends' || rel === 'outgoing' || rel === 'incoming') && data.requestId && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => onRemove(data.requestId, rel === 'friends' ? 'Удалён из друзей' : 'Заявка отменена')}
            >{rel === 'friends' ? 'Удалить из друзей' : 'Отменить заявку'}</button>
          )}
        </div>

        <div className="modal-title-row">
          <span className="modal-title">Любимые песни</span>
        </div>
        {favs.length === 0 ? (
          <p className="modal-empty">Пользователь пока не выбрал любимые песни</p>
        ) : (
          <div className="modal-list">
            {favs.map((track, i) => (
              <div key={track.id} className="track-item" onClick={() => onPlay(favs, i)}>
                <img className="track-cover" src={track.image || initialCover(track.name)} alt="" loading="lazy"
                     onError={(e) => handleCoverError(e, track)} />
                <div className="track-info">
                  <div className="track-name">{track.name}</div>
                  <div className="track-artist">{track.artist_name}</div>
                </div>
                <div className="track-duration">{formatDuration(track.duration)}</div>
                <span className="friend-track-play">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-title-row" style={{ marginTop: 16 }}>
          <span className="modal-title">Публичные плейлисты</span>
        </div>
        {loadingPl ? (
          <div className="profile-loading"><span className="btn-spinner"></span></div>
        ) : publicPlaylists.length > 0 ? (
          <div className="modal-list">
            {publicPlaylists.map(pl => (
              <div key={pl.id} className="track-item friend-playlist-item">
                <span className="friend-pl-cover">
                  {pl.tracks[0]?.image
                    ? <img src={pl.tracks[0].image} alt="" onError={(e) => handleCoverError(e, pl.tracks[0])} />
                    : <span className="pl-card-empty"><IconMusic size={16} /></span>}
                </span>
                <div className="track-info">
                  <div className="track-name">{pl.name}</div>
                  <div className="track-artist">{pl.tracks.length} треков</div>
                </div>
                {pl.tracks.length > 0 && (
                  <span className="friend-track-play" onClick={(e) => { e.stopPropagation(); onPlay(pl.tracks, 0) }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="modal-empty">Публичных плейлистов нет</p>
        )}
      </div>
    </div>
  )
}
