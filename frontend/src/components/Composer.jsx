import { useEffect, useRef, useState } from 'react'

function BubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function Composer({ onSend, streaming, onStop, agent, onToggleAgent, bubble, onToggleBubble }) {
  const [value, setValue] = useState('')
  const taRef = useRef(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  function submit() {
    if (streaming || !value.trim()) return
    onSend(value)
    setValue('')
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const hasText = value.trim().length > 0

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="toggles">
          <button
            className={`toggle-pill ${agent ? 'on' : ''}`}
            onClick={onToggleAgent}
            title={agent ? "Mode Agent activé — l'IA utilise ses outils" : "Activer l'Agent — l'IA pourra utiliser ses outils (recherche, fichiers, téléphone…)"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v2" />
              <path d="M12 19v2" />
              <path d="M3 12h2" />
              <path d="M19 12h2" />
              <path d="M5.6 5.6l1.4 1.4" />
              <path d="M17 17l1.4 1.4" />
              <path d="M18.4 5.6 17 7" />
              <path d="M7 17l-1.4 1.4" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
            Agent
          </button>
          <button
            className={`toggle-pill ${bubble ? 'on' : ''}`}
            onClick={onToggleBubble}
            title={bubble ? 'Désactiver la bulle Arkel' : 'Activer la bulle Arkel'}
          >
            <BubbleIcon />
            Bulle
          </button>
        </div>

        <div className="composer-box">
          <button className="icon-btn" aria-label="Joindre" title="Joindre (bientôt)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <textarea
            ref={taRef}
            rows={1}
            value={value}
            placeholder="Message ou maintenir pour parler"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />

          {!streaming && (
            <button className="icon-btn" aria-label="Dicter" title="Dicter (bientôt)">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
          )}

          <button
            className={`send-btn ${streaming ? 'stop' : ''}`}
            onClick={streaming ? onStop : submit}
            disabled={!streaming && !hasText}
            aria-label={streaming ? 'Arrêter' : 'Envoyer'}
          >
            {streaming ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
