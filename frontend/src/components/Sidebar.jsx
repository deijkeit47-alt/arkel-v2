import { ArkelLogo } from './Logo.jsx'

export default function Sidebar({ open, conversations, activeId, quota, onNew, onSelect, onClose, onOpenSettings, onOpenLibrary }) {
  return (
    <>
      <div className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <ArkelLogo size={26} />
          <span className="brand-name">Arkel</span>
        </div>

        <button className="new-chat" onClick={onNew}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nouvelle discussion
        </button>

        <div className="sidebar-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input placeholder="Rechercher" />
        </div>

        <button className="library-btn" onClick={onOpenLibrary}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </svg>
          Bibliothèque
        </button>

        <div className="conv-list">
          <div className="conv-list-label">Discussions</div>
          {conversations.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--faint)', fontSize: '13.5px' }}>
              Aucune discussion pour l'instant.
            </div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="dot" />
              <span className="ellipsis">{c.title}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          {quota && quota.total > 0 && (
            <div className="quota-bar-wrap">
              <div className="quota-bar-track">
                <div
                  className="quota-bar-fill"
                  style={{ width: `${Math.min(100, (quota.used / quota.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <button className="profile-btn" onClick={onOpenSettings}>
            <div className="avatar">{((quota && quota.name) || 'A').charAt(0).toUpperCase()}</div>
            <div className="who">
              {(quota && quota.name) || 'Arkel'}
              <small>{quota && quota.plan === 'pro' ? 'Pro' : 'Gratuit'}</small>
            </div>
          </button>
        </div>
      </div>
      <div className={`overlay ${open ? 'show' : ''}`} onClick={onClose} />
    </>
  )
}
