import { useState } from 'react'
import PaymentScreen from './PaymentScreen.jsx'

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function PlanCard({ title, price, features, highlighted, buttonLabel, onChoose }) {
  return (
    <div className={`plan-card ${highlighted ? 'highlighted' : ''}`}>
      <div className="plan-head">
        <span className="plan-title">{title}</span>
        {highlighted && <span className="plan-badge">Recommandé</span>}
      </div>
      <div className="plan-price">{price}</div>
      <div className="plan-features">
        {features.map((f) => (
          <div key={f} className="plan-feature">
            <Check />
            <span>{f}</span>
          </div>
        ))}
      </div>
      <button className={`plan-btn ${highlighted ? 'accent' : ''}`} onClick={onChoose}>
        {buttonLabel}
      </button>
    </div>
  )
}

export default function SubscriptionScreen({ onClose }) {
  const [step, setStep] = useState('plans')

  return (
    <div className="sub-overlay" onClick={onClose}>
      <div className="sub-modal" onClick={(e) => e.stopPropagation()}>
        {step === 'plans' ? (
          <>
            <div className="sub-header">
              <h2>Choisis ton offre Arkel</h2>
              <button className="sub-close" onClick={onClose}>✕</button>
            </div>
            <p className="sub-sub">
              Paiement : Orange Money, MTN MoMo, Kulu, YMO, PayCard, carte bancaire.
            </p>

            <div className="sub-plans">
              <PlanCard
                title="Gratuit"
                price="0 GNF"
                features={[
                  'Commandes de base du téléphone',
                  '20 actions par jour',
                  '1 voix',
                  'Mémoire locale',
                ]}
                buttonLabel="Choisir Gratuit"
                onChoose={onClose}
              />
              <PlanCard
                title="Pro"
                price="50 000 GNF / mois"
                features={[
                  'Toutes les capacités',
                  'Actions illimitées',
                  'Toutes les voix + réglages',
                  'Commandes flash',
                  "Réflexion de l'IA visible",
                  'Priorité du serveur',
                ]}
                highlighted
                buttonLabel="Choisir Pro"
                onChoose={() => setStep('payment')}
              />
            </div>

            <div className="sub-payments">
              <span>Orange Money</span>
              <span>MTN MoMo</span>
              <span>Kulu</span>
              <span>YMO</span>
              <span>PayCard</span>
              <span>Carte</span>
            </div>
          </>
        ) : (
          <PaymentScreen onBack={() => setStep('plans')} />
        )}
      </div>
    </div>
  )
}
