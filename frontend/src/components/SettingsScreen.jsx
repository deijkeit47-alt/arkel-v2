import { useState } from 'react'
import { getServer, setServer } from '../api.js'

function Row({ label, sub, onClick }) {
  return (
    <button className="set-row" onClick={onClick}>
      <span className="set-label">{label}</span>
      {sub && <span className="set-sub">{sub}</span>}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--faint)' }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}

function Toggle({ label, sub, value, onChange }) {
  return (
    <div className="set-toggle">
      <span className="set-label">{label}</span>
      {sub && <span className="set-sub">{sub}</span>}
      <button className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
        <span className="knob" />
      </button>
    </div>
  )
}

// Champ « Serveur » : l'URL du backend auquel Arkel se connecte (réseau privé).
function ServerField() {
  const [url, setUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const save = () => {
    setServer(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div className="server-field">
      <div className="set-section">Serveur</div>
      <p className="server-hint">Adresse du backend auquel Arkel se connecte (réseau privé).</p>
      <div className="server-input-row">
        <input
          className="server-input"
          value={url}
          placeholder="http://192.168.1.10:8787"
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
        />
        <button className="server-save" onClick={save}>{saved ? '✓' : 'Enregistrer'}</button>
      </div>
    </div>
  )
}

export default function SettingsScreen({ onClose, onLogout, onOpenSubscription, deepThink, onToggleThink }) {
  const email = localStorage.getItem('arkel.email') || 'Connecté'

  return (
    <div className="sub-overlay" onClick={onClose}>
      <div className="sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sub-header">
          <h2>Paramètres</h2>
          <button className="sub-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-list">
          <div className="set-section">Compte</div>
          <Row label="Compte" sub={email} />
          <Row label="Abonnement" sub="Gérer ton offre" onClick={onOpenSubscription} />

          <div className="set-section">Apparence</div>
          <Row label="Thème" sub="Sombre" />
          <Row label="Langue" sub="Français" />
          <Toggle
            label="Afficher la réflexion de l'IA"
            sub="Les pensées du modèle, visibles dans la réponse"
            value={deepThink}
            onChange={onToggleThink}
          />

          <div className="set-section">Voix</div>
          <Row label="Voix" sub="Voix du système" />
          <Row label="Vitesse" sub="Normale" />

          <div className="set-section">Vie privée</div>
          <Row label="Ce que Arkel sait de moi" sub="Voir, corriger, effacer chaque fait" />
          <Row label="Historique des conversations" />
          <Row label="Journal d'audit" sub="L'historique des actions exécutées" />
          <Row label="Exporter mes données" />
          <Row label="Tout effacer" />

          <div className="set-section">À propos</div>
          <Row label="Arkel 0.1.0" sub="Version stable" />

          <ServerField />

          <button className="logout-full" onClick={onLogout}>Se déconnecter</button>
        </div>
      </div>
    </div>
  )
}
