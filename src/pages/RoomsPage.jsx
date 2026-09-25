import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlayer } from '../contexts/PlayerContext'
import { useSettings } from '../contexts/SettingsContext'
import { initialCover, handleCoverError } from '../services/soundcloud'
import {
  createRoom, getUserRooms, joinRoom, leaveRoom, closeRoom,
  getRoomMembers, generateInviteCode, joinRoomByCode,
  getRoomComments, addRoomComment, getRoomReactions, addRoomReaction,
  deleteStaleRoomChat, subscribeRoomChat,
} from '../services/rooms'
import { IconMusic } from '../components/Icons'

const REACTIONS_EMOJIS = ['👍', '❤️', '🔥', '😂', '😍', '🎶']
const COMMENT_TTL_MS = 10 * 60000   // комментарий стирается через 10 минут
const REACTION_WINDOW_MS = 3 * 60000 // реакции видны 3 минуты

const nowMs = () => Date.now()
const isFresh = (createdAt, ttlMs) => nowMs() - new Date(createdAt).getTime() < ttlMs

export default function RoomsPage() {
  const { user, isGuest } = useAuth()
  const { currentTrack, playTrack, isPlaying, togglePlay } = usePlayer()
  const { settings } = useSettings()
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [newRoomName, setNewRoomName] = useState('')
  const [creating, setCreating] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [roomMembers, setRoomMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [showInviteInput, setShowInviteInput] = useState(false)
  const [joiningCode, setJoiningCode] = useState('')
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [reactions, setReactions] = useState([])
  const [ticker, setTicker] = useState(nowMs())
  const timerRef = useRef(null)
  const lastReactionRef = useRef({})
  const shimmerClass = settings.nickShimmer ? 'nick-shimmer' : ''

  const flash = useCallback((msg) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setNotice(msg)
    timerRef.current = setTimeout(() => setNotice(''), 2500)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const loadRooms = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await getUserRooms(user.id)
      setRooms(data)
    } catch (err) {
      console.error('Load rooms error:', err)
      flash('Ошибка загрузки комнат')
    } finally {
      setLoading(false)
    }
  }, [user, flash])

  useEffect(() => {
    if (isGuest || !user) return
    loadRooms()
  }, [user, isGuest, loadRooms])

  const handleCreateRoom = async (e) => {
    e.preventDefault()
    if (!user || !newRoomName.trim()) return
    setCreating(true)
    try {
      const room = await createRoom(user.id, newRoomName.trim())
      if (room) {
        const roomWithCount = { ...room, memberCount: 1 }
        setRooms(prev => [roomWithCount, ...prev])
        setNewRoomName('')
        flash('Комната создана')
        setSelectedRoom(roomWithCount)
        setInviteCode(generateInviteCode(room.id))
      } else {
        flash('Ошибка создания комнаты')
      }
    } catch (err) {
      flash('Ошибка создания комнаты')
    } finally {
      setCreating(false)
    }
  }

  const handleJoinByCode = async () => {
    if (!user || !joiningCode.trim()) return
    try {
      const success = await joinRoomByCode(user.id, joiningCode.trim())
      if (success) {
        flash('Вы присоединились к комнате')
        await loadRooms()
        setShowInviteInput(false)
        setJoiningCode('')
      } else {
        flash('Комната не найдена')
      }
    } catch (err) {
      flash('Ошибка присоединения')
    }
  }

  const handleLeaveRoom = async (room) => {
    if (!user) return
    try {
      await leaveRoom(user.id, room.id)
      setRooms(prev => prev.filter(r => r.id !== room.id))
      if (selectedRoom?.id === room.id) {
        setSelectedRoom(null)
      }
      flash('Вы покинули комнату')
    } catch (err) {
      flash('Ошибка выхода из комнаты')
    }
  }

  const handleCloseRoom = async (room) => {
    if (!window.confirm(`Закрыть комнату «${room.name}»?`)) return
    try {
      await closeRoom(room.id)
      setRooms(prev => prev.filter(r => r.id !== room.id))
      if (selectedRoom?.id === room.id) {
        setSelectedRoom(null)
      }
      flash('Комната закрыта')
    } catch (err) {
      flash('Ошибка закрытия комнаты')
    }
  }

  const loadRoomMembers = async (room) => {
    setMembersLoading(true)
    try {
      const members = await getRoomMembers(room.id)
      setRoomMembers(members)
      setRooms(prev => prev.map(r =>
        r.id === room.id ? { ...r, memberCount: members.length } : r
      ))
      setSelectedRoom(prev =>
        prev?.id === room.id ? { ...prev, memberCount: members.length } : prev
      )
    } catch (err) {
      console.error('Load members error:', err)
    } finally {
      setMembersLoading(false)
    }
  }

  const openRoom = async (room) => {
    setSelectedRoom(room)
    setRoomMembers([])
    setInviteCode(generateInviteCode(room.id))
    await loadRoomMembers(room)
  }

  const copyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      flash('Код скопирован')
    } catch {
      flash('Не удалось скопировать')
    }
  }

  // Ник участника по id: берём из загруженного списка участников
  const nickOf = useCallback((uid) => {
    const m = roomMembers.find(mm => mm.user_id === uid)
    return m?.profiles?.nickname || (uid === user?.id ? 'Вы' : 'Гость')
  }, [roomMembers, user])

  const timeAgo = (iso) => {
    const s = Math.max(0, Math.floor((nowMs() - new Date(iso).getTime()) / 1000))
    if (s < 60) return `${s}с`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}м`
    return `${Math.floor(m / 60)}ч`
  }

  const pushComment = useCallback((row) => {
    setComments(prev => (prev.some(c => c.id === row.id) ? prev : [row, ...prev]))
  }, [])

  const pushReaction = useCallback((row, preventSpamMs = 0) => {
    const key = `${row.user_id}:${row.emoji}`
    const last = lastReactionRef.current[key]
    if (last && nowMs() - last < preventSpamMs) return
    lastReactionRef.current[key] = nowMs()
    setReactions(prev => (prev.some(rr => rr.id === row.id) ? prev : [row, ...prev]))
  }, [])

  // Живой чат комнаты: загрузка, realtime от других участников,
  // периодический опрос и чистка «протухших» сообщений
  useEffect(() => {
    if (!selectedRoom || !user) return
    let cancelled = false

    const loadComments = async () => {
      const data = await getRoomComments(selectedRoom.id)
      if (!cancelled) setComments(data)
    }
    const loadReactions = async () => {
      const data = await getRoomReactions(selectedRoom.id)
      if (!cancelled) setReactions(data)
    }

    loadComments()
    loadReactions()

    const unsubscribe = subscribeRoomChat(selectedRoom.id, {
      onComment: (row) => { if (!cancelled) pushComment(row) },
      onReaction: (row) => { if (!cancelled) pushReaction(row, 6000) },
    })

    const poll = setInterval(() => { loadComments(); loadReactions() }, 10000)
    const stale = setInterval(() => {
      deleteStaleRoomChat(selectedRoom.id)
      loadComments()
      loadReactions()
    }, 60000)
    const tick = setInterval(() => setTicker(nowMs()), 30000)

    return () => {
      cancelled = true
      unsubscribe()
      clearInterval(poll)
      clearInterval(stale)
      clearInterval(tick)
    }
  }, [selectedRoom, user, pushComment, pushReaction])

  const handleSendComment = async () => {
    const text = commentText.trim()
    if (!text || sendingComment || !selectedRoom) return
    setSendingComment(true)
    const row = await addRoomComment(selectedRoom.id, user.id, text)
    if (row) {
      pushComment(row)
      setCommentText('')
    } else {
      flash('Не удалось отправить комментарий')
    }
    setSendingComment(false)
  }

  const handleReact = async (emoji) => {
    if (!selectedRoom) return
    const key = `${user.id}:${emoji}`
    const last = lastReactionRef.current[key]
    if (last && nowMs() - last < 3000) return
    lastReactionRef.current[key] = nowMs()
    const row = await addRoomReaction(selectedRoom.id, user.id, emoji)
    if (row) pushReaction(row)
  }

  void ticker

  if (isGuest || !user) {
    return (
      <div className="screen rooms-screen">
        <h2 className="screen-title">Комнаты</h2>
        <div className="empty-state">
          <p>Комнаты доступны только с аккаунтом</p>
          <p className="empty-hint">Выйдите из гостевого режима и войдите или зарегистрируйтесь</p>
        </div>
      </div>
    )
  }

  if (selectedRoom) {
    const isCreator = selectedRoom.creator_id === user.id
    return (
      <div className="screen rooms-screen rooms-detail">
        <div className="room-detail-header">
          <button className="btn btn-outline btn-sm" onClick={() => setSelectedRoom(null)}>
            ← Все комнаты
          </button>
          <span className="room-detail-name">{selectedRoom.name}</span>
          <span className="room-detail-count">{roomMembers.length} участн.</span>
        </div>

        {notice && <div className="room-notice">{notice}</div>}

        <div className="room-now-playing">
          {currentTrack ? (
            <div className="room-track-info">
              <img
                className="room-track-cover"
                src={currentTrack.image || initialCover(currentTrack.name)}
                alt=""
                onError={(e) => handleCoverError(e, currentTrack)}
              />
              <div className="room-track-details">
                <span className="room-track-name">{currentTrack.name}</span>
                <span className="room-track-artist">{currentTrack.artist_name}</span>
              </div>
              <button
                className={`room-play-btn ${isPlaying ? 'playing' : ''}`}
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1"/>
                    <rect x="14" y="4" width="4" height="16" rx="1"/>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 20 12 6 21 6 3"/>
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <div className="room-no-track">Трек не выбран</div>
          )}
        </div>

        <div className="room-reactions-section">
          <h3 className="room-section-title">Реакции на трек</h3>
          <div className="room-reactions-bar">
            {REACTIONS_EMOJIS.map(emoji => (
              <button
                key={emoji}
                className="room-reaction-btn"
                onClick={() => handleReact(emoji)}
                title={`Реакция ${emoji}`}
              >{emoji}</button>
            ))}
          </div>
          {(
            reactions
              .filter(r => isFresh(r.created_at, REACTION_WINDOW_MS))
              .slice(0, 24)
          ).length > 0 ? (
            <div className="reactions-feed">
              {reactions
                .filter(r => isFresh(r.created_at, REACTION_WINDOW_MS))
                .slice(0, 24)
                .map(r => (
                  <span key={r.id} className="reaction-chip">
                    <span className="reaction-emoji">{r.emoji}</span>
                    <span className={`reaction-nick ${shimmerClass}`}>{nickOf(r.user_id)}</span>
                  </span>
                ))}
            </div>
          ) : (
            <p className="room-chat-empty">Реакций пока нет — нажмите на эмодзи выше</p>
          )}
        </div>

        <div className="room-invite-section">
          <h3 className="room-section-title">Пригласить друга</h3>
          <div className="room-invite-code">
            <span className="invite-label">Код:</span>
            <span className="invite-value">{inviteCode}</span>
            <button className="btn btn-sm" onClick={copyInviteCode}>
              Копировать
            </button>
          </div>
        </div>

        <div className="room-members-section">
          <h3 className="room-section-title">
            Участники {membersLoading ? '…' : `(${roomMembers.length})`}
          </h3>
          {membersLoading ? (
            <div className="room-members-loading">
              <span className="btn-spinner"></span>
            </div>
          ) : (
            <div className="members-list">
              {roomMembers.map((member) => (
                <div key={member.user_id} className="member-item">
                  {member.profiles?.avatar ? (
                    <img className="member-avatar" src={member.profiles.avatar} alt="" />
                  ) : (
                    <div className="member-avatar-empty"><IconMusic size={14} /></div>
                  )}
                  <span className={`member-name ${shimmerClass}`}>
                    {member.profiles?.nickname || 'Гость'}
                    {member.user_id === selectedRoom.creator_id && (
                      <span className="member-owner-badge">создатель</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="room-comments-section">
          <h3 className="room-section-title">
            Комментарии <em className="room-chat-hint">(стираются через 10 мин)</em>
          </h3>
          <div className="room-comments-list">
            {comments
              .filter(c => isFresh(c.created_at, COMMENT_TTL_MS))
              .length === 0 ? (
              <p className="room-chat-empty">Пока нет комментариев</p>
            ) : (
              comments
                .filter(c => isFresh(c.created_at, COMMENT_TTL_MS))
                .map(c => (
                  <div key={c.id} className="room-comment">
                    <div className="room-comment-head">
                      <span className={`room-comment-nick ${shimmerClass}`}>{nickOf(c.user_id)}</span>
                      {c.user_id === user.id && <span className="room-comment-me">вы</span>}
                      <span className="room-comment-time">{timeAgo(c.created_at)}</span>
                    </div>
                    <div className="room-comment-text">{c.content}</div>
                  </div>
                ))
            )}
          </div>
          <div className="room-comment-input-row">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendComment() }}
              placeholder="Написать комментарий..."
              maxLength={500}
              disabled={sendingComment}
            />
            <button
              className="btn btn-sm"
              onClick={handleSendComment}
              disabled={!commentText.trim() || sendingComment}
            >
              {sendingComment ? '…' : 'Отправить'}
            </button>
          </div>
        </div>

        <div className="room-actions">
          {isCreator ? (
            <button
              className="btn btn-outline btn-danger"
              onClick={() => handleCloseRoom(selectedRoom)}
            >
              Закрыть комнату
            </button>
          ) : (
            <button
              className="btn btn-outline"
              onClick={() => handleLeaveRoom(selectedRoom)}
            >
              Покинуть комнату
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="screen rooms-screen">
      <h2 className="screen-title">Комнаты совместного прослушивания</h2>

      <form className="room-create" onSubmit={handleCreateRoom}>
        <input
          type="text"
          value={newRoomName}
          onChange={e => setNewRoomName(e.target.value)}
          placeholder="Название новой комнаты..."
          maxLength={50}
          disabled={creating}
        />
        <button type="submit" className="btn btn-sm" disabled={!newRoomName.trim() || creating}>
          {creating ? '…' : 'Создать'}
        </button>
      </form>

      {showInviteInput ? (
        <div className="room-join-invite">
          <input
            type="text"
            value={joiningCode}
            onChange={e => setJoiningCode(e.target.value)}
            placeholder="Введите код приглашения..."
          />
          <button className="btn btn-sm" onClick={handleJoinByCode}>Присоединиться</button>
          <button className="btn btn-outline btn-sm" onClick={() => { setShowInviteInput(false); setJoiningCode('') }}>Отмена</button>
        </div>
      ) : (
        <button className="btn btn-outline btn-sm" onClick={() => setShowInviteInput(true)}>
          Присоединиться по коду
        </button>
      )}

      {notice && <div className="room-notice">{notice}</div>}

      {loading ? (
        <div className="rooms-loading"><span className="btn-spinner"></span></div>
      ) : rooms.length > 0 ? (
        <div className="rooms-grid">
          {rooms.map(room => (
            <button key={room.id} className="room-card" onClick={() => openRoom(room)}>
              <div className="room-card-icon"><IconMusic size={22} /></div>
              <span className="room-card-name">{room.name}</span>
              <span className="room-card-meta">{room.memberCount ?? 0} участников</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>Пока нет комнат</p>
          <p className="empty-hint">Создайте новую комнату или присоединитесь по коду приглашения</p>
        </div>
      )}
    </div>
  )
}
