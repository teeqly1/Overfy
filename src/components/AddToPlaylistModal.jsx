import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { getPlaylists, createPlaylist, addToPlaylist } from '../services/userData'

// Модалка «Добавить в плейлист»: выбор существующего или создание нового.
export default function AddToPlaylistModal({ track, onClose }) {
  const [playlists, setPlaylists] = useState(getPlaylists)
  const [newName, setNewName] = useState('')
  const [addedTo, setAddedTo] = useState(null)

  const handleAdd = (pl) => {
    if (addToPlaylist(pl.id, track)) {
      setAddedTo(pl.name)
      setTimeout(onClose, 700)
    } else {
      setAddedTo(`${pl.name}: трек уже есть`)
      setTimeout(onClose, 900)
    }
  }

  const handleCreate = (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const pl = createPlaylist(name)
    addToPlaylist(pl.id, track)
    setAddedTo(pl.name)
    setTimeout(onClose, 700)
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Добавить в плейлист</div>
        <div className="modal-track">{track.name}</div>

        <div className="modal-list">
          {playlists.length === 0 && (
            <div className="modal-empty">Плейлистов пока нет — создайте первый ниже</div>
          )}
          {playlists.map(pl => (
            <button key={pl.id} className="modal-row" onClick={() => handleAdd(pl)}>
              <span className="modal-row-name">{pl.name}</span>
              <span className="modal-row-count">{pl.tracks.length}</span>
            </button>
          ))}
        </div>

        <form className="modal-create" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Новый плейлист..."
            autoFocus
          />
          <button type="submit" className="btn btn-sm" disabled={!newName.trim()}>Создать</button>
        </form>

        {addedTo && <div className="modal-ok">Добавлено: {addedTo}</div>}
      </div>
    </div>,
    document.body
  )
}
