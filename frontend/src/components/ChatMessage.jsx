import { useEffect, useState } from 'react'
import Markdown from './Markdown.jsx'
import { getBase } from '../api.js'
import { getMediaUrl } from '../mediaStore.js'

function Chevron({ up }) {
  return (
    <svg className={`chevron ${up ? 'up' : ''}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// Type de média d'après l'extension → rendu adapté (image, vidéo, audio, fichier).
function fileKind(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
  return 'file'
}

function formatSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}

// Un widget de réflexion (une phase de thinking). « live » = en cours de réflexion.
function ThinkingWidget({ text, live, main, seconds }) {
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!live) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  const hasText = (text || '').length > 0
  if (!live && !hasText) return null
  const showPanel = live ? hasText : open

  return (
    <div className="thinking">
      <button
        className="thinking-toggle"
        onClick={() => !live && setOpen((o) => !o)}
        disabled={live}
        style={{ cursor: live ? 'default' : 'pointer' }}
      >
        {live ? (
          <span className="live-dot" />
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 21h4" />
            <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z" />
          </svg>
        )}
        <span>
          {live
            ? `Réfléchit${elapsed > 0 ? ` · ${elapsed}s` : '…'}`
            : main && seconds > 0
              ? `Réfléchi · ${seconds}s`
              : 'Réfléchi'}
        </span>
        {!live && <Chevron up={open} />}
      </button>

      {showPanel && (
        <div className="thinking-panel">
          <p>{text}</p>
        </div>
      )}
    </div>
  )
}

// Charge le média depuis le stockage local du téléphone (IndexedDB).
// Fallback : URL du backend (fichier pas encore téléchargé sur le téléphone).
function useLocalUrl(name) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    getMediaUrl(name).then((u) => { if (alive && u) setUrl(u) })
    return () => { alive = false }
  }, [name])
  return url
}

function FileMedia({ f }) {
  const kind = fileKind(f.name)
  const local = useLocalUrl(f.name)
  const url = local || `${getBase()}/file/${encodeURIComponent(f.name)}`
  if (kind === 'image') {
    return <img className="file-img" src={url} alt={f.name} loading="lazy" onClick={() => window.open(url, '_blank')} />
  }
  if (kind === 'video') {
    return <video className="file-video" src={url} controls preload="metadata" />
  }
  if (kind === 'audio') {
    return <audio className="file-audio" src={url} controls />
  }
  return (
    <a className="file-card" href={url} target="_blank" rel="noreferrer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span>{f.name}</span>
      {f.size > 0 && <small>{formatSize(f.size)}</small>}
    </a>
  )
}

export default function ChatMessage({ message }) {
  if (message.role === 'system') {
    return (
      <div className="msg msg-system">
        <span>{message.content}</span>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="user-bubble">{message.content}</div>
      </div>
    )
  }

  // Segments de réflexion et de réponse, entrelacés par phase :
  // réflexion[0] → réponse[0] → réflexion[1] → réponse[1] → …
  const segs = Array.isArray(message.reasoning)
    ? message.reasoning
    : message.reasoning
      ? [message.reasoning]
      : []
  const blocks = Array.isArray(message.content)
    ? message.content
    : message.content
      ? [message.content]
      : []
  const liveIdx = message.thinking ? segs.length - 1 : -1

  const items = []
  const n = Math.max(segs.length, blocks.length)
  for (let i = 0; i < n; i++) {
    if (i < segs.length) items.push({ kind: 'thinking', i, text: segs[i] })
    if (i < blocks.length && blocks[i]) items.push({ kind: 'content', i, text: blocks[i] })
  }

  return (
    <div className="msg msg-ai">
      <div className="ai-body">
        {(message.tools || []).length > 0 && (
          <div className="tool-pills">
            {(message.tools || []).map((t) => (
              <span key={t} className="tool-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
                {t}
              </span>
            ))}
          </div>
        )}

        {items.map((it, k) => {
          if (it.kind === 'thinking') {
            return <ThinkingWidget key={k} text={it.text} live={liveIdx === it.i} main={it.i === 0} seconds={message.seconds} />
          }
          return (
            <div key={k} className="ai-text">
              <Markdown>{it.text}</Markdown>
              {message.thinking && it.i === blocks.length - 1 && <span className="cursor" />}
            </div>
          )
        })}

        {(message.files || []).length > 0 && (
          <div className="file-list">
            {(message.files || []).map((f, i) => <FileMedia key={i} f={f} />)}
          </div>
        )}
      </div>
    </div>
  )
}
