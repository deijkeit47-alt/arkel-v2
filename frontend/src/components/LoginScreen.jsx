import { useState } from 'react'
import {
  login, signupSend, signupVerify,
  signupPhoneSend, signupPhoneVerify, loginPhoneSend, loginPhoneVerify,
} from '../api.js'

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </svg>
)

export default function LoginScreen({ onLogin }) {
  const [tab, setTab] = useState('login')      // login | signup
  const [method, setMethod] = useState('email') // email | phone
  const [step, setStep] = useState('form')      // form | code | name
  // e-mail
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // numéro
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setStep('form'); setError(''); setNotice('')
    setCode(''); setName(''); setPassword('')
  }
  function switchTab(t) { setTab(t); reset() }
  function switchMethod(m) { setMethod(m); reset() }

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } finally { setBusy(false) }
  }

  // ── Connexion e-mail ──
  async function doLoginEmail(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Renseigne ton e-mail et ton mot de passe.'); return }
    await run(async () => {
      try {
        const { token } = await login(email.trim(), password)
        onLogin(token, email.trim())
      } catch (err) { setError(err.message || 'Service indisponible') }
    })
  }

  // ── Connexion numéro ──
  async function doLoginPhoneSend(e) {
    e.preventDefault()
    if (!phone.trim()) { setError('Renseigne ton numéro WhatsApp.'); return }
    await run(async () => {
      try {
        await loginPhoneSend(phone.trim())
        setStep('code'); setNotice('Code envoyé sur ton WhatsApp.')
      } catch (err) { setError(err.message || 'Service indisponible') }
    })
  }
  async function doLoginPhoneVerify(e) {
    e.preventDefault()
    if (!code.trim()) return
    await run(async () => {
      try {
        const { token } = await loginPhoneVerify(phone.trim(), code.trim())
        onLogin(token, phone.trim())
      } catch (err) { setError(err.message || 'Code invalide') }
    })
  }

  // ── Inscription e-mail ──
  async function doSignupEmail(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password) { setError('Renseigne ton prénom, ton e-mail et un mot de passe.'); return }
    await run(async () => {
      try {
        await signupSend(name.trim(), email.trim(), password)
        setStep('code'); setNotice('Code envoyé (code de test : 1958).')
      } catch (err) { setError(err.message || 'Service indisponible') }
    })
  }
  async function doSignupEmailVerify(e) {
    e.preventDefault()
    if (!code.trim()) return
    await run(async () => {
      try {
        const { token } = await signupVerify(email.trim(), code.trim())
        onLogin(token, email.trim())
      } catch (err) { setError(err.message || 'Code invalide') }
    })
  }

  // ── Inscription numéro (numéro → code WhatsApp → prénom) ──
  async function doSignupPhoneSend(e) {
    e.preventDefault()
    if (!phone.trim()) { setError('Renseigne ton numéro WhatsApp.'); return }
    await run(async () => {
      try {
        await signupPhoneSend(phone.trim())
        setStep('code'); setNotice('Code envoyé sur ton WhatsApp.')
      } catch (err) { setError(err.message || 'Service indisponible') }
    })
  }
  async function doSignupPhoneCode(e) {
    e.preventDefault()
    if (!code.trim()) return
    setStep('name'); setError('')
  }
  async function doSignupPhoneName(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Renseigne ton prénom.'); return }
    await run(async () => {
      try {
        const { token } = await signupPhoneVerify(phone.trim(), code.trim(), name.trim())
        onLogin(token, phone.trim())
      } catch (err) { setError(err.message || 'Code invalide') }
    })
  }

  const back = () => { setStep('form'); setError(''); setNotice('') }

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="auth-logo" src="/arkel-logo.jpeg" alt="Arkel" />
        <h1 className="auth-brand">Arkel</h1>

        {/* Onglets Connexion / Inscription */}
        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>Connexion</button>
          <button type="button" className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => switchTab('signup')}>Inscription</button>
        </div>

        {/* Bascule E-mail / Numéro */}
        <div className="auth-method-toggle">
          <button type="button" className={`auth-method-tab ${method === 'email' ? 'active' : ''}`} onClick={() => switchMethod('email')}>E-mail</button>
          <button type="button" className={`auth-method-tab ${method === 'phone' ? 'active' : ''}`} onClick={() => switchMethod('phone')}>Numéro</button>
        </div>

        {/* ══════════ INSCRIPTION PAR NUMÉRO : numéro → code → prénom ══════════ */}
        {tab === 'signup' && method === 'phone' && step === 'form' && (
          <form className="auth-form" onSubmit={doSignupPhoneSend}>
            <input type="tel" placeholder="Ton numéro WhatsApp (ex : +224 6XX XX XX XX)" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le code'}</button>
          </form>
        )}
        {tab === 'signup' && method === 'phone' && step === 'code' && (
          <form className="auth-form" onSubmit={doSignupPhoneCode}>
            <h2 className="auth-title">Vérification</h2>
            <p className="auth-sub">Entre le code reçu sur WhatsApp.</p>
            <input type="text" inputMode="numeric" placeholder="Code de confirmation" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>Continuer</button>
            <button type="button" className="auth-back" onClick={back}>← Retour</button>
          </form>
        )}
        {tab === 'signup' && method === 'phone' && step === 'name' && (
          <form className="auth-form" onSubmit={doSignupPhoneName}>
            <h2 className="auth-title">Ton prénom</h2>
            <p className="auth-sub">C'est par ce prénom qu'Arkel t'appellera.</p>
            <input type="text" placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Création…' : "Terminer"}</button>
          </form>
        )}

        {/* ══════════ CONNEXION PAR NUMÉRO : numéro → code ══════════ */}
        {tab === 'login' && method === 'phone' && step === 'form' && (
          <form className="auth-form" onSubmit={doLoginPhoneSend}>
            <input type="tel" placeholder="Ton numéro WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le code'}</button>
          </form>
        )}
        {tab === 'login' && method === 'phone' && step === 'code' && (
          <form className="auth-form" onSubmit={doLoginPhoneVerify}>
            <h2 className="auth-title">Vérification</h2>
            <p className="auth-sub">Entre le code reçu sur WhatsApp.</p>
            <input type="text" inputMode="numeric" placeholder="Code de confirmation" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier'}</button>
            <button type="button" className="auth-back" onClick={back}>← Retour</button>
          </form>
        )}

        {/* ══════════ E-MAIL ══════════ */}
        {method === 'email' && tab === 'login' && (
          <form className="auth-form" onSubmit={doLoginEmail}>
            <input type="text" placeholder="E-mail ou identifiant" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
          </form>
        )}
        {method === 'email' && tab === 'signup' && step === 'form' && (
          <form className="auth-form" onSubmit={doSignupEmail}>
            <input type="text" placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} required />
            <input type="text" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Envoi…' : "S'inscrire"}</button>
          </form>
        )}
        {method === 'email' && tab === 'signup' && step === 'code' && (
          <form className="auth-form" onSubmit={doSignupEmailVerify}>
            <h2 className="auth-title">Vérification</h2>
            <p className="auth-sub">Saisis le code de confirmation envoyé à {email}</p>
            <input type="text" inputMode="numeric" placeholder="Code de confirmation" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier'}</button>
            <button type="button" className="auth-back" onClick={back}>← Retour</button>
          </form>
        )}

        {/* Google (à venir) */}
        {tab === 'login' && method === 'email' && step === 'form' && (
          <div className="auth-divider"><span>ou continuer avec</span></div>
        )}
        {tab === 'login' && method === 'email' && step === 'form' && (
          <div className="auth-methods">
            <button type="button" className="auth-method" onClick={() => setNotice('Connexion Google — bientôt.')}>
              <GoogleG /> Google
            </button>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
      </div>
    </div>
  )
}
