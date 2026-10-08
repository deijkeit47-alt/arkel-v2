import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatMessage from './components/ChatMessage.jsx'
import Composer from './components/Composer.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import SubscriptionScreen from './components/SubscriptionScreen.jsx'
import LibraryScreen from './components/LibraryScreen.jsx'
import SettingsScreen from './components/SettingsScreen.jsx'
import { ArkelLogo } from './components/Logo.jsx'
import * as api from './api.js'
import { saveMedia } from './mediaStore.js'

let nextId = 1

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('arkel.token') || '')
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem('arkel.conversations')
      if (saved) {
        const convs = JSON.parse(saved)
        if (Array.isArray(convs)) {
          let maxId = 0
          for (const c of convs) {
            if (c.id > maxId) maxId = c.id
            for (const m of c.messages || []) {
              if (m.id > maxId) maxId = m.id
            }
          }
          nextId = maxId + 1
          return convs
        }
      }
    } catch (_) {}
    return []
  })
  const [activeId, setActiveId] = useState(() => {
    const aid = localStorage.getItem('arkel.activeId')
    return aid && aid !== '' ? Number(aid) : null
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [agent, setAgent] = useState(false)
  const [askAgent, setAskAgent] = useState(null)
  const [bubble, setBubble] = useState(() => localStorage.getItem('arkel.bubble') === '1')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [clarify, setClarify] = useState(null)
  const [quota, setQuota] = useState(null)
  const [showSubscription, setShowSubscription] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)

  async function loadQuota() {
    if (!token) return
    try {
      setQuota(await api.quota(token))
    } catch (_) {}
  }

  useEffect(() => {
    loadQuota()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // ── Persistance des discussions (survivent au redémarrage de l'app) ──
  useEffect(() => {
    try {
      localStorage.setItem('arkel.conversations', JSON.stringify(conversations))
      localStorage.setItem('arkel.activeId', activeId == null ? '' : String(activeId))
    } catch (_) {}
  }, [conversations, activeId])

  const scrollRef = useRef(null)
  const atBottomRef = useRef(true)
  const cancelRef = useRef(false)
  const turnRef = useRef(0)
  const streamingAiIdRef = useRef(null)
  const autoScrollRef = useRef(false)

  const active = conversations.find((c) => c.id === activeId) || null
  const messages = active ? active.messages : []

  // Médias partagés par l'IA (pour la bibliothèque) — dédupliqués par nom
  const allMedia = []
  for (const c of conversations) {
    for (const m of (c.messages || [])) {
      for (const f of (m.files || [])) {
        if (!allMedia.some((x) => x.name === f.name)) allMedia.push(f)
      }
    }
  }

  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      autoScrollRef.current = true
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      requestAnimationFrame(() => { autoScrollRef.current = false })
    }
  }, [messages, activeId])

  function onScroll() {
    if (autoScrollRef.current) return  // ignore le scroll programmé (suivi auto pendant le streaming)
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  }

  function scrollNow() {
    atBottomRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  function onLogin(t, email) {
    localStorage.setItem('arkel.token', t)
    if (email) localStorage.setItem('arkel.email', email)
    setToken(t)
  }

  function logout() {
    localStorage.removeItem('arkel.token')
    localStorage.removeItem('arkel.conversations')
    localStorage.removeItem('arkel.activeId')
    setToken('')
    setConversations([])
    setActiveId(null)
    setStreaming(false)
  }

  function buildHistory(msgs) {
    const h = []
    for (const m of msgs) {
      if (m.role === 'user' && m.content) h.push({ role: 'user', content: m.content })
      else if (m.role === 'assistant' && m.content) {
        // le contenu est un tableau de blocs → le concaténer en texte simple
        const text = Array.isArray(m.content) ? m.content.join('') : m.content
        if (text) h.push({ role: 'assistant', content: text })
      }
    }
    return h.slice(-20)
  }

  function askUser(question, choices) {
    return new Promise((resolve) => setClarify({ question, choices: choices || [], resolve }))
  }

  function submitClarify(answer) {
    const c = clarify
    if (!c) return
    setClarify(null)
    c.resolve(answer || '')
  }

  async function send(text, opts = {}) {
    const { forceAgent = null, skipUser = false, refused = false, historyOverride = null } = opts
    const t = text.trim()
    if (!t) return
    // Interception des codes de recharge : l'IA ne les voit JAMAIS (entre l'app et le backend seulement)
    if (/^Arkel_/i.test(t)) {
      handleRedeem(t)
      return
    }
    // Interruption : un nouveau message pendant la génération bloque la tâche en cours.
    if (streaming) interruptCurrent()

    const myTurn = ++turnRef.current
    cancelRef.current = false

    let convId = activeId
    if (convId == null) {
      convId = nextId++
      const title = t.length > 34 ? t.slice(0, 34) + '…' : t
      setConversations((prev) => [{ id: convId, title, messages: [] }, ...prev])
      setActiveId(convId)
    }
    const history = historyOverride ?? buildHistory(active ? active.messages : [])

    const userId = nextId++
    const aiId = nextId++
    const userMsg = { id: userId, role: 'user', content: t }
    const aiMsg = {
      id: aiId,
      role: 'assistant',
      content: [''],
      reasoning: [''],
      thinking: true,
      seconds: 0,
      tools: [],
      files: [],
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, ...(skipUser ? [aiMsg] : [userMsg, aiMsg])] } : c,
      ),
    )
    setStreaming(true)
    streamingAiIdRef.current = aiId
    atBottomRef.current = true

    const patchAi = (p) =>
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: c.messages.map((m) => (m.id === aiId ? { ...m, ...p } : m)) }
            : c,
        ),
      )

    const start = Date.now()
    const model = deepThink ? 'novad' : 'nook'
    let reasoningSegments = ['']   // segments de réflexion (un nouveau widget par phase)
    let contentBlocks = ['']       // segments de réponse (un par phase, entrelacés avec la réflexion)
    let contentSeen = false
    let shown = ''                 // partie déjà révélée du DERNIER segment de réponse
    const tools = []
    const files = []
    let revealTimer = null
    let finished = false   // le stream est terminé (le reveal continue jusqu'au bout)

    // Révélation progressive (effet machine à écrire) : le contenu arrive en
    // tampon puis défile caractère par caractère, même si le backend envoie
    // vite ou en gros blocs — la réponse ne sort jamais d'un coup.
    const revealTick = () => {
      if (turnRef.current !== myTurn || cancelRef.current) { stopReveal(); return }
      const lastIdx = contentBlocks.length - 1
      const full = contentBlocks[lastIdx]
      if (shown.length >= full.length) { stopReveal(); return }
      shown = full.slice(0, shown.length + 4)
      const display = [...contentBlocks]
      display[lastIdx] = shown
      patchAi({ content: display })
    }
    const startReveal = () => {
      if (revealTimer) return
      revealTimer = setInterval(revealTick, 25)  // ~160 caractères/seconde
    }
    const stopReveal = () => {
      if (revealTimer) {
        clearInterval(revealTimer)
        revealTimer = null
      }
    }

    try {
      await api.streamChat({
        token,
        message: t,
        model,
        history,
        conversationId: String(convId),
        agent: forceAgent ?? agent,
        refused,
        onEvent: async (ev) => {
          if (turnRef.current !== myTurn || cancelRef.current) return
          if (ev.type === 'reasoning') {
            if (contentSeen) {
              reasoningSegments.push('')
              contentBlocks.push('')   // nouvelle réponse après cette réflexion
              shown = ''               // repart sur un reveal neuf
              contentSeen = false
            }
            reasoningSegments[reasoningSegments.length - 1] += ev.text || ''
            patchAi({ reasoning: [...reasoningSegments] })
          } else if (ev.type === 'content') {
            contentSeen = true
            contentBlocks[contentBlocks.length - 1] += ev.text || ''
            startReveal()
          } else if (ev.type === 'tool') {
            if (ev.status === 'started' && ev.name && !tools.includes(ev.name)) {
              tools.push(ev.name)
              patchAi({ tools: [...tools] })
            }
          } else if (ev.type === 'file') {
            const fname = ev.name || ''
            if (!files.some((f) => f.name === fname)) {
              files.push({ name: fname, size: ev.size || 0 })
              patchAi({ files: [...files] })
              // Télécharge le média sur le téléphone (IndexedDB) — rien ne reste sur le PC
              fetch(`${api.getBase()}/file/${encodeURIComponent(fname)}`)
                .then((r) => r.blob())
                .then((blob) => saveMedia(fname, blob, ev.size || 0))
                .catch(() => {})
            }
          } else if (ev.type === 'clarify') {
            const a = await askUser(ev.question || '', ev.choices || [])
            try {
              await api.answer({ token, turn_id: ev.turn_id, answer: a })
            } catch (_) {}
          } else if (ev.type === 'ask_agent') {
            // L'IA a besoin de ses outils → garder le message utilisateur, proposer Accepter/Refuser
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convId ? { ...c, messages: c.messages.filter((m) => m.id !== aiId) } : c,
              ),
            )
            setAskAgent({ text: t, convId, history })
          } else if (ev.type === 'done') {
            finished = true
            const seconds = Math.max(1, Math.round((Date.now() - start) / 1000))
            patchAi({ thinking: false, seconds })
            if (contentBlocks.every((b) => b === '')) {
              stopReveal()
              patchAi({ content: ['Service indisponible pour le moment. Réessaie dans quelques instants.'] })
            }
            // sinon : le reveal continue et fait défiler la réponse jusqu'au bout
          }
        },
      })
    } catch (e) {
      if (turnRef.current === myTurn && !cancelRef.current) {
        stopReveal()
        patchAi({
          thinking: false,
          seconds: Math.round((Date.now() - start) / 1000),
          content: contentBlocks.some((b) => b !== '') ? contentBlocks : ['Service indisponible pour le moment. Réessaie dans quelques instants.'],
        })
      }
    } finally {
      // On NE stoppe PAS le reveal : la réponse finit de défiler après la fin du stream.
      if (turnRef.current === myTurn) {
        if (cancelRef.current) {
          stopReveal()
          const blocks = contentBlocks.filter((b) => b !== '')
          patchAi({
            thinking: false,
            content: [...blocks, '⏹ Génération arrêtée.'],
          })
        }
        setStreaming(false)
        cancelRef.current = false
        streamingAiIdRef.current = null
        loadQuota()
      }
    }
  }

  function interruptCurrent() {
    // Bloque réellement la tâche : invalide le tour + annule côté serveur + marque le message.
    turnRef.current++
    cancelRef.current = true
    const cid = activeId != null ? String(activeId) : ''
    api.cancel({ token, conversation_id: cid }).catch(() => {})
    const oldAiId = streamingAiIdRef.current
    if (oldAiId != null) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === oldAiId
                    ? { ...m, thinking: false, content: [...(Array.isArray(m.content) ? m.content : (m.content ? [m.content] : [])), '⏹ Génération arrêtée.'] }
                    : m,
                ),
              }
            : c,
        ),
      )
    }
    streamingAiIdRef.current = null
    setStreaming(false)
  }

  function stop() {
    interruptCurrent()
  }

  function activateAgent() {
    const req = askAgent
    if (!req) return
    setAskAgent(null)
    setAgent(true)
    send(req.text, { forceAgent: true, skipUser: true, historyOverride: req.history })
  }

  function refuseAgent() {
    const req = askAgent
    if (!req) return
    setAskAgent(null)
    send(req.text, { refused: true, skipUser: true, historyOverride: req.history })
  }

  async function handleRedeem(codeText) {
    // Recharge : le code reste entre l'app et le backend, JAMAIS montré ni envoyé à l'IA.
    let convId = activeId
    if (convId == null) {
      convId = nextId++
      setConversations((prev) => [{ id: convId, title: 'Nouvelle discussion', messages: [] }, ...prev])
      setActiveId(convId)
    }
    const sid = nextId++
    const sysMsg = { id: sid, role: 'system', content: 'Vérification du code…' }
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, sysMsg] } : c)),
    )
    atBottomRef.current = true
    try {
      const r = await api.redeem(token, codeText)
      const msg = r.reset ? '✅ Quota réinitialisé.' : '✅ Quota rechargé.'
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === sid ? { ...m, content: msg } : m)) } : c)),
      )
    } catch (_) {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === sid ? { ...m, content: '❌ Code invalide.' } : m)) } : c)),
      )
    }
    loadQuota()
  }

  function newChat() {
    if (streaming) return
    setActiveId(null)
    setSidebarOpen(false)
    atBottomRef.current = true
  }

  function selectChat(id) {
    setActiveId(id)
    setSidebarOpen(false)
    atBottomRef.current = true
  }

  if (!token) {
    return <LoginScreen onLogin={onLogin} />
  }

  const modelLabel = deepThink ? 'Novad' : 'Nook'

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        quota={quota}
        onNew={newChat}
        onSelect={selectChat}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenLibrary={() => setShowLibrary(true)}
      />
      <div className="main">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="model-select">
            <button className="model-chip" onClick={() => setModelMenuOpen((o) => !o)}>
              <span className="model-dot" />
              {modelLabel}
              <span className="chip-sub">· {deepThink ? 'Réflexion' : 'Rapide'}</span>
              <svg className="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {modelMenuOpen && (
              <div className="model-menu">
                <button
                  className="model-option"
                  onClick={() => { setDeepThink(true); setModelMenuOpen(false) }}
                >
                  <span className="model-dot" />
                  <span className="model-option-text">
                    <span className="mo-name">Novad</span>
                    <span className="mo-sub">Réflexion approfondie</span>
                  </span>
                  {deepThink && <span className="mo-check">✓</span>}
                </button>
                <button
                  className="model-option"
                  onClick={() => { setDeepThink(false); setModelMenuOpen(false) }}
                >
                  <span className="model-dot" style={{ background: 'var(--muted)' }} />
                  <span className="model-option-text">
                    <span className="mo-name">Nook</span>
                    <span className="mo-sub">Rapide — au quotidien</span>
                  </span>
                  {!deepThink && <span className="mo-check">✓</span>}
                </button>
              </div>
            )}
          </div>
          <button className="sub-btn" title="Abonnement" onClick={() => setShowSubscription(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8l4 5 5-3 5 3 4-5-2 12H5L3 8z" />
            </svg>
            Abonnement
          </button>
        </div>

        <div className="chat-wrap">
          <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="logo-big"><ArkelLogo size={48} /></div>
                <h1>Bonjour, que puis-je faire pour vous ?</h1>
              </div>
            ) : (
              <div className="chat-inner">
                {messages.map((m) => (
                  <ChatMessage key={m.id} message={m} />
                ))}
              </div>
            )}
          </div>

          {!atBottomRef.current && messages.length > 0 && (
            <button className="scroll-btn" onClick={scrollNow} aria-label="Revenir en bas">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>

        {askAgent && (
          <div className="ask-agent-banner">
            <span>⚡ Cette demande nécessite l'Agent.</span>
            <button onClick={activateAgent}>Accepter</button>
            <button className="ask-agent-refuse" onClick={refuseAgent}>Refuser</button>
          </div>
        )}

        <Composer
          onSend={send}
          streaming={streaming}
          onStop={stop}
          agent={agent}
          onToggleAgent={() => setAgent((v) => !v)}
          bubble={bubble}
          onToggleBubble={() => setBubble((v) => { localStorage.setItem('arkel.bubble', v ? '0' : '1'); return !v })}
        />
      </div>

      {clarify && (
        <ClarifyModal
          question={clarify.question}
          choices={clarify.choices}
          onAnswer={submitClarify}
        />
      )}

      {showSubscription && (
        <SubscriptionScreen onClose={() => setShowSubscription(false)} />
      )}

      {showSettings && (
        <SettingsScreen
          onClose={() => setShowSettings(false)}
          onLogout={logout}
          onOpenSubscription={() => { setShowSettings(false); setShowSubscription(true) }}
          deepThink={deepThink}
          onToggleThink={() => setDeepThink((v) => !v)}
        />
      )}

      {showLibrary && (
        <LibraryScreen
          media={allMedia}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  )
}

function ClarifyModal({ question, choices, onAnswer }) {
  const [text, setText] = useState('')
  return (
    <div className="clarify-overlay" onClick={() => onAnswer('')}>
      <div className="clarify-card" onClick={(e) => e.stopPropagation()}>
        <p className="clarify-q">{question}</p>
        {choices.length > 0 && (
          <div className="clarify-choices">
            {choices.map((c) => (
              <button key={c} className="clarify-choice" onClick={() => onAnswer(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <input
          autoFocus={choices.length === 0}
          placeholder="Écris ta réponse…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAnswer(text)
          }}
        />
        <div className="clarify-actions">
          <button className="clarify-skip" onClick={() => onAnswer('')}>Ignorer</button>
          <button className="clarify-send" onClick={() => onAnswer(text)}>Envoyer</button>
        </div>
      </div>
    </div>
  )
}
