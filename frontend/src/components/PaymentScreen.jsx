import { useState } from 'react'

const OPERATORS = [
  { name: 'Orange Money', logo: '/payments/orange_money.png' },
  { name: 'MTN MoMo', logo: '/payments/mtn.png' },
  { name: 'Kulu', logo: '/payments/kulu.svg' },
  { name: 'YMO', logo: '/payments/ymo.png' },
  { name: 'PayCard', logo: '/payments/paycard.png' },
  { name: 'Carte bancaire', logo: null },
]

function CardIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

export default function PaymentScreen({ onBack }) {
  const [picked, setPicked] = useState('')

  return (
    <div>
      <button className="sub-back" onClick={onBack}>← Retour</button>
      <h2 className="pay-title">Abonnement Pro — 50 000 GNF / mois</h2>
      <p className="sub-sub">Choisis ton mode de paiement :</p>

      <div className="pay-list">
        {OPERATORS.map((o) => (
          <button key={o.name} className="pay-item" onClick={() => setPicked(o.name)}>
            <span className="pay-logo">
              {o.logo ? <img src={o.logo} alt={o.name} /> : <CardIcon />}
            </span>
            <span className="pay-name">{o.name}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--faint)' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>

      {picked && (
        <div className="sub-notice">
          {picked} sélectionné — tu recevras la confirmation de paiement.
        </div>
      )}
    </div>
  )
}
