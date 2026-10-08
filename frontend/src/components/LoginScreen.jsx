import { useState } from 'react'
import { login, signupSend, signupVerify } from '../api.js'

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
  const [tab, setTab] = useState('login')   // login | signup
  const [step, setStep] = useState('form')   // form | code
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function doLogin(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Renseigne ton e-mail et ton mot de passe.'); return }
    setBusy(true); setError('')
    try {
      const { token } = await login(email.trim(), password)
      onLogin(token, email.trim())
    } catch (err) {
      setError(err.message || 'Service indisponible')
    } finally { setBusy(false) }
  }

  async function doSignup(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password) { setError('Renseigne ton nom, ton e-mail et un mot de passe.'); return }
    setBusy(true); setError('')
    try {
      await signupSend(name.trim(), email.trim(), password)
      setStep('code')
      setNotice('Code envoyé par e-mail (code de test : 1958).')
    } catch (err) {
      setError(err.message || 'Service indisponible')
    } finally { setBusy(false) }
  }

  async function doVerify(e) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true); setError('')
    try {
      const { token } = await signupVerify(email.trim(), code.trim())
      onLogin(token, email.trim())
    } catch (err) {
      setError(err.message || 'Code invalide')
    } finally { setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="auth-logo" src="/arkel-logo.jpeg" alt="Arkel" />
        <h1 className="auth-brand">Arkel</h1>

        {step === 'code' ? (
          <form className="auth-form" onSubmit={doVerify}>
            <h2 className="auth-title">Vérification</h2>
            <p className="auth-sub">Saisis le code de confirmation envoyé à {email}</p>
            <input type="text" inputMode="numeric" placeholder="Code de confirmation" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier'}</button>
            <button type="button" className="auth-back" onClick={() => { setStep('form'); setError('') }}>← Retour</button>
          </form>
        ) : (
          <>
            <div className="auth-tabs">
              <button type="button" className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError('') }}>Connexion</button>
              <button type="button" className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => { setTab('signup'); setError('') }}>Inscription</button>
            </div>

            {tab === 'login' ? (
              <form className="auth-form" onSubmit={doLogin}>
                <input type="text" placeholder="E-mail ou identifiant" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
                <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={doSignup}>
                <input type="text" placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} required />
                <input type="text" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
                <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
                <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Envoi…' : "S'inscrire"}</button>
              </form>
            )}

            <div className="auth-divider"><span>ou continuer avec</span></div>
            <div className="auth-methods">
              <button type="button" className="auth-method" onClick={() => setNotice('Connexion Google — bientôt.')}>
                <GoogleG /> Google
              </button>
              <button type="button" className="auth-method" onClick={() => setNotice('Connexion par numéro — bientôt.')}>
                <PhoneIcon /> Numéro
              </button>
            </div>
          </>
        )}

        {error && <div className="auth-error">{error}</div>}
        {notice && step !== 'code' && <div className="auth-notice">{notice}</div>}
        {notice && step === 'code' && <div className="auth-notice">{notice}</div>}
      </div>
    </div>
  )
}
