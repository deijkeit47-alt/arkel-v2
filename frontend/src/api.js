// Client API Arkel — pointe vers le backend Control Plane (FastAPI, port 8787).
// L'URL du serveur est configurable dans les Paramètres (champ « Serveur ») :
// chaque téléphone peut pointer vers le PC de l'utilisateur qui partage son backend
// (réseau privé). Sans configuration, on tombe sur le défaut local (127.0.0.1:8787).
const DEFAULT_BASE = 'http://127.0.0.1:8787'

export function getBase() {
  const s = localStorage.getItem('arkel.server')
  return (s && s.trim() ? s.trim() : DEFAULT_BASE).replace(/\/+$/, '')
}

export function getServer() {
  return localStorage.getItem('arkel.server') || DEFAULT_BASE
}

export function setServer(url) {
  localStorage.setItem('arkel.server', (url || '').trim())
}

async function post(path, body, token) {
  const res = await fetch(`${getBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let data = {}
    try { data = await res.json() } catch (_) {}
    throw new Error(data.error || 'Service indisponible')
  }
  return res.json()
}

export async function login(email, password) {
  return post('/login', { email, password })
}

// Inscription en 2 étapes (envoi du code, puis vérification).
export function signupSend(name, email, password) {
  return post('/signup', { step: 'send', name, email, password })
}
export function signupVerify(email, code) {
  return post('/signup', { step: 'verify', email, code })
}

// Inscription par numéro (code WhatsApp via Helena) : numéro → code → prénom.
export function signupPhoneSend(phone) {
  return post('/signup', { method: 'phone', step: 'send', phone })
}
export function signupPhoneVerify(phone, code, name) {
  return post('/signup', { method: 'phone', step: 'verify', phone, code, name })
}

// Connexion par numéro (code WhatsApp) : numéro → code.
export function loginPhoneSend(phone) {
  return post('/login', { method: 'phone', step: 'send', phone })
}
export function loginPhoneVerify(phone, code) {
  return post('/login', { method: 'phone', step: 'verify', phone, code })
}

// SSE : POST /chat/stream → lit les événements `data: {json}`.
// onEvent est appelé pour chaque événement (reasoning, content, tool, file, clarify, done).
// Il peut être async (clarify attend la réponse de l'utilisateur).
export async function streamChat({ token, message, model, history, conversationId, agent, refused, onEvent }) {
  const res = await fetch(`${getBase()}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      token,
      message,
      model,
      history: history || [],
      conversation_id: conversationId || '',
      agent: !!agent,
      refused: !!refused,
    }),
  })
  if (!res.ok || !res.body) {
    let data = {}
    try { data = await res.json() } catch (_) {}
    throw new Error(data.error || 'Service indisponible')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      let ev
      try { ev = JSON.parse(payload) } catch (_) { continue }
      await onEvent(ev)
      if (ev.type === 'done') return
    }
  }
}

// Réponse à une question posée par l'IA (clarify).
export function answer({ token, turn_id, answer: text }) {
  return post('/answer', { token, turn_id, answer: text }, token)
}

// Arrêt global d'un tour.
export function cancel({ token, conversation_id }) {
  return post('/cancel', { token, conversation_id }, token)
}

// Recharge / réinitialisation du quota (codes interceptés côté app — jamais vus par l'IA).
export function redeem(token, code) {
  return post('/redeem', { token, code }, token)
}

export function quota(token) {
  return fetch(`${getBase()}/quota?token=${encodeURIComponent(token)}`).then((r) => r.json())
}
