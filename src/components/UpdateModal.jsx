import React, { useState } from 'react'
import { downloadAndInstall } from '../services/updates'

export default function UpdateModal({ update, onClose, onSkip }) {
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState(null)

  const handleInstall = async () => {
    setDownloading(true)
    const res = await downloadAndInstall(update.url)
    setResult(res)
    if (res.ok) {
      setTimeout(() => onClose(), 1500)
    }
  }

  return (
    <div className="modal-overlay" onClick={onSkip}>
      <div className="modal-box update-modal" onClick={e => e.stopPropagation()}>
        <div className="update-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <h2 className="update-title">Обновление приложения</h2>
        <span className="update-version">Версия {update.version}</span>
        {update.changelog && (
          <div className="update-changelog">
            <span className="update-changelog-label">Что изменилось:</span>
            <p className="update-changelog-text">{update.changelog}</p>
          </div>
        )}
        {result ? (
          <div className={`update-result ${result.ok ? 'update-result--ok' : 'update-result--err'}`}>
            {result.ok ? 'Обновление установлено. Приложение перезапускается...' : result.message}
          </div>
        ) : (
          <div className="update-actions">
            <button
              className="btn btn-primary"
              onClick={handleInstall}
              disabled={downloading}
            >
              {downloading ? (
                <span style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="btn-spinner" />
                  Установка...
                </span>
              ) : 'Установить'}
            </button>
            <button className="btn btn-ghost" onClick={onSkip}>
              Продолжить со старой версией
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
