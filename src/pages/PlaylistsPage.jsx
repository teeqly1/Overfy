import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError, isScTrackId, refreshScStreamUrl } from '../services/soundcloud'
import {
  getPlaylists, createPlaylist, deletePlaylist, renamePlaylist,
  removeFromPlaylist, setPlaylistVisibility, setPlaylistCover, setPlaylistDescription, reorderPlaylistTracks,
  loadPlaylistsFromCloud,
  getImportedTracks, addImportedTrack, removeImportedTrack, loadImportedFromCloud, localTrackId,
} from '../services/userData'
import { isDesktop } from '../services/tauriBridge'
import { IconGlobe, IconLock, IconEdit, IconTrash, IconClose, IconMusic } from '../components/Icons'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'wma']

export default function PlaylistsPage() {
  const { isGuest } = useAuth()
  const { playTrack, playTrackAt } = usePlayer()
  const [playlists, setPlaylists] = useState(getPlaylists)
  const [openPl, setOpenPl] = useState(null)
  const [imported, setImported] = useState(getImportedTracks)
  const [newName, setNewName] = useState('')
  const [newVisibility, setNewVisibility] = useState('private')
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const coverInputRef = useRef(null)

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 2500) }

  // Открытие плейлиста, которого уже нет (удалён из другого экрана) —
  // без setState внутри рендера
  useEffect(() => {
    if (openPl && playlists.length && !playlists.find(p => p.id === openPl)) {
      setOpenPl(null)
    }
  }, [openPl, playlists])

  useEffect(() => {
    let active = true
    Promise.all([loadPlaylistsFromCloud(), loadImportedFromCloud()])
      .then(([pls, imp]) => { if (active) { setPlaylists(pls); setImported(imp) } })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const handleCreate = (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setPlaylists(createPlaylist(name, newVisibility))
    setNewName('')
    setNewVisibility('private')
  }

  const handleRename = async (pl) => {
    const name = window.prompt('Новое название плейлиста', pl.name)
    if (name == null) return
    setPlaylists(renamePlaylist(pl.id, name))
  }

  const handleEditDescription = (pl) => {
    setDescDraft(pl.description || '')
    setEditingDesc(true)
  }

  const handleSaveDescription = () => {
    if (!openPl) return
    setPlaylists(setPlaylistDescription(openPl, descDraft))
    setEditingDesc(false)
    flash('Описание обновлено')
  }

  const handleDelete = async (pl) => {
    if (!window.confirm(`Удалить плейлист «${pl.name}»?`)) return
    setOpenPl(null)
    setPlaylists(deletePlaylist(pl.id))
  }

  const handleToggleVisibility = (pl) => {
    const next = pl.visibility === 'public' ? 'private' : 'public'
    setPlaylists(setPlaylistVisibility(pl.id, next))
    flash(next === 'public' ? 'Плейлист теперь публичный' : 'Плейлист теперь приватный')
  }

  const ensureAudio = useCallback(async (t) => {
    if (t.audio || !isScTrackId(t.id)) return t
    const url = await refreshScStreamUrl(t.id).catch(() => null)
    return { ...t, audio: url || undefined }
  }, [])

  const handleCoverFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      flash('Файл больше 4 МБ — выберите меньше')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPlaylists(setPlaylistCover(openPl, reader.result))
      setOpenPl(openPl)
      flash('Обложка обновлена')
    }
    reader.onerror = () => flash('Не удалось прочитать файл')
    reader.readAsDataURL(file)
  }

  const visibilityIcon = (publiclyVisible) => (
    publiclyVisible ? <IconGlobe size={15} style={{ verticalAlign: 'middle' }} /> : <IconLock size={15} style={{ verticalAlign: 'middle' }} />
  )

  const playPlaylist = async (pl) => {
    if (!pl.tracks.length) return
    const resolved = await Promise.all(pl.tracks.map(ensureAudio))
    playTrackAt(resolved, 0)
  }

  const playImported = async (t) => {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const list = imported.map(x => ({ ...localToTrack(x), audio: convertFileSrc(x.path) }))
    playTrack({ ...localToTrack(t), audio: convertFileSrc(t.path) }, list)
  }

  const handleImport = async () => {
    if (!isDesktop()) {
      flash('Импорт доступен в приложении (десктоп-версия)')
      return
    }
    setImporting(true)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      const selected = await open({
        multiple: true,
        title: 'Выберите аудиофайлы',
        filters: [{ name: 'Аудио', extensions: AUDIO_EXTENSIONS }],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      let added = 0
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
        const duration = await readDuration(convertFileSrc(path))
        addImportedTrack({ path, name, duration })
        added++
      }
      setImported(getImportedTracks())
      flash(`Импортировано: ${added}`)
    } catch (e) {
      flash(`Ошибка импорта: ${e?.message || e}`)
    } finally {
      setImporting(false)
    }
  }

  const readDuration = (src) => new Promise((resolve) => {
    const el = new Audio()
    el.preload = 'metadata'
    el.addEventListener('loadedmetadata', () => resolve(Math.round(el.duration || 0)), { once: true })
    el.addEventListener('error', () => resolve(0), { once: true })
    el.src = src
    setTimeout(() => resolve(0), 8000)
  })

  if (openPl) {
    const pl = playlists.find(p => p.id === openPl)
    if (!pl) return null
    const isPublic = pl.visibility === 'public'
    const coverSrc = pl.cover || pl.tracks[0]?.image || initialCover(pl.name)
    return (
      <div className="screen playlists-screen">
        <div className="pl-open-header">
          <button className="btn btn-outline btn-sm" onClick={() => setOpenPl(null)}>← Все плейлисты</button>
          <span className="pl-open-name">{pl.name}</span>
          <span className="pl-open-count">{pl.tracks.length} треков</span>
          <button className="btn btn-outline btn-sm" onClick={() => handleRename(pl)}>
            <IconEdit size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Переименовать
          </button>
          {!isGuest && (
            <button
              className={`btn btn-outline btn-sm pl-visibility-toggle ${isPublic ? 'is-public' : ''}`}
              onClick={() => handleToggleVisibility(pl)}
              title={isPublic ? 'Сделать приватным' : 'Сделать публичным'}
            >
              {isPublic ? visibilityIcon(true) : visibilityIcon(false)} {isPublic ? 'Публичный' : 'Приватный'}
            </button>
          )}
        </div>

        {editingDesc ? (
          <div className="pl-desc-edit">
            <textarea
              className="pl-desc-input"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder="Описание плейлиста..."
              maxLength={500}
              autoFocus
            />
            <div className="pl-desc-actions">
              <button className="btn btn-sm" onClick={handleSaveDescription}>Сохранить</button>
              <button className="btn btn-outline btn-sm" onClick={() => setEditingDesc(false)}>Отмена</button>
            </div>
            <span className="pl-desc-counter">{descDraft.length}/500</span>
          </div>
        ) : (
          <div className="pl-desc-view">
            {pl.description ? (
              <p className="pl-desc-text">{pl.description}</p>
            ) : (
              <p className="pl-desc-empty">Нет описания</p>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => handleEditDescription(pl)}>
              <IconEdit size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {pl.description ? 'Редактировать' : 'Добавить'} описание
            </button>
          </div>
        )}

        <div className="pl-open-cover-row">
          <div className="pl-open-cover-wrap">
            <img
              className="pl-open-cover"
              src={coverSrc}
              alt=""
              onError={(e) => handleCoverError(e, pl.tracks[0] || pl)}
            />
            <button
              className="pl-open-cover-edit"
              onClick={() => coverInputRef.current?.click()}
              title="Сменить обложку"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>
              </svg>
            </button>
            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverFile} />
          </div>
          {pl.tracks.length > 0 && (
            <button className="btn pl-play-all" onClick={() => playPlaylist(pl)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              Играть плейлист
            </button>
          )}
        </div>
        <div className="track-list">
          {pl.tracks.length === 0 && (
            <p className="empty-hint">Пусто. Добавляйте треки кнопкой «в плейлист» в поиске и избранном</p>
          )}
          {pl.tracks.map((t, i) => {
            const full = { ...t, audio: null }
            return (
              <div
                key={`${t.id}_${i}`}
                className="track-item"
                onClick={async () => {
                  const resolved = await ensureAudio(full)
                  playTrack(resolved, (await Promise.all(pl.tracks.map(x => ensureAudio({ ...x, audio: null })))))
                }}
              >
                <img className="track-cover" src={t.image || initialCover(t.name)} alt="" loading="lazy" onError={(e) => handleCoverError(e, t)} />
                <div className="track-info">
                  <div className="track-name">{t.name}</div>
                  <div className="track-artist">{t.artist_name}</div>
                </div>
                <div className="track-duration">{formatDuration(t.duration)}</div>
                {pl.tracks.length > 1 && (
                  <div className="pl-track-arrows">
                    <button
                      className="next-btn visible-on-hover"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPlaylists(reorderPlaylistTracks(pl.id, i, i - 1))
                        setOpenPl(pl.id)
                      }}
                      title="Выше"
                    >↑</button>
                    <button
                      className="next-btn visible-on-hover"
                      disabled={i === pl.tracks.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPlaylists(reorderPlaylistTracks(pl.id, i, i + 1))
                        setOpenPl(pl.id)
                      }}
                      title="Ниже"
                    >↓</button>
                  </div>
                )}
                <button
                  className="queue-remove visible"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPlaylists(removeFromPlaylist(pl.id, t.id))
                    setOpenPl(pl.id)
                  }}
                  title="Убрать из плейлиста"
                >
                  <IconClose size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="screen playlists-screen">
      <h2 className="screen-title">Плейлисты</h2>

      <form className="pl-create" onSubmit={handleCreate}>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Название нового плейлиста..."
        />
        {!isGuest && (
          <button
            type="button"
            className={`btn btn-outline btn-sm pl-visibility-toggle ${newVisibility === 'public' ? 'is-public' : ''}`}
            onClick={() => setNewVisibility(v => v === 'private' ? 'public' : 'private')}
            title={newVisibility === 'public' ? 'Публичный — виден в профиле' : 'Приватный — только вы'}
          >
            {newVisibility === 'public' ? <IconGlobe size={14} /> : <IconLock size={14} />}
          </button>
        )}
        <button type="submit" className="btn btn-sm" disabled={!newName.trim()}>Создать</button>
      </form>

      {notice && <div className="pl-notice">{notice}</div>}

      <div className="pl-grid">
        {playlists.map(pl => (
          <button key={pl.id} className="playlist-card" onClick={() => setOpenPl(pl.id)}>
            <span className="pl-card-cover">
              {(pl.cover || pl.tracks[0]?.image)
                ? <img src={pl.cover || pl.tracks[0].image} alt="" onError={(e) => handleCoverError(e, pl.tracks[0] || pl)} />
                : <span className="pl-card-empty"><IconMusic size={24} /></span>}
            </span>
            <span className="playlist-name">{pl.name}</span>
            <span className="playlist-meta">
              {pl.tracks.length} треков
              {pl.visibility === 'public' && <span className="pl-visibility-badge"><IconGlobe size={12} /></span>}
            </span>
            <span className="pl-card-actions">
              {!isGuest && (
                <i
                  className="pl-action"
                  role="button"
                  title={pl.visibility === 'public' ? 'Сделать приватным' : 'Сделать публичным'}
                  onClick={(e) => { e.stopPropagation(); handleToggleVisibility(pl) }}
                >{pl.visibility === 'public' ? <IconGlobe size={14} /> : <IconLock size={14} />}</i>
              )}
              <i
                className="pl-action"
                role="button"
                title="Переименовать"
                onClick={(e) => { e.stopPropagation(); handleRename(pl) }}
              ><IconEdit size={14} /></i>
              <i
                className="pl-action danger"
                role="button"
                title="Удалить"
                onClick={(e) => { e.stopPropagation(); handleDelete(pl) }}
              ><IconTrash size={14} /></i>
            </span>
          </button>
        ))}
        {playlists.length === 0 && (
          <p className="empty-hint">Создайте плейлист и соберите свою коллекцию</p>
        )}
      </div>

      <section className="pl-import">
        <div className="pl-import-header">
          <h3 className="settings-group-title">Импорт песен с компьютера</h3>
          <button className="btn btn-sm" onClick={handleImport} disabled={importing}>
            {importing ? <span className="btn-spinner" /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            Выбрать файлы
          </button>
        </div>
        <p className="empty-hint">MP3, WAV, OGG, FLAC и другие форматы. Файлы остаются на компьютере, пути сохраняются.</p>
        <div className="track-list">
          {imported.map((t, i) => (
            <div key={t.path} className="track-item" onClick={() => playImported(t)}>
              <img className="track-cover" src={initialCover(t.name)} alt="" />
              <div className="track-info">
                <div className="track-name">{t.name}</div>
                <div className="track-artist">Локальный файл</div>
              </div>
              <div className="track-duration">{formatDuration(t.duration)}</div>
              <button
                className="queue-remove visible"
                onClick={(e) => { e.stopPropagation(); setImported(removeImportedTrack(t.path)) }}
                title="Убрать"
              >
                <IconClose size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function localToTrack(t) {
  return {
    id: localTrackId(t.path),
    name: t.name,
    artist_name: 'Локальный файл',
    duration: t.duration || 0,
    image: initialCover(t.name),
    audio: null,
    source: 'local',
    path: t.path,
  }
}
