import { getBase } from '../api.js'

function fileKind(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
  return 'file'
}

export default function LibraryScreen({ media, onClose }) {
  const items = media.filter((f) => fileKind(f.name) !== 'file')

  return (
    <div className="library-overlay" onClick={onClose}>
      <div className="library-card" onClick={(e) => e.stopPropagation()}>
        <div className="library-head">
          <h2>Bibliothèque</h2>
          <button className="library-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {items.length === 0 ? (
          <p className="library-empty">Aucune photo ni vidéo partagée pour l'instant.</p>
        ) : (
          <div className="library-grid">
            {items.map((f, i) => {
              const url = `${getBase()}/file/${encodeURIComponent(f.name)}`
              const kind = fileKind(f.name)
              if (kind === 'image') {
                return (
                  <img
                    key={i}
                    className="library-img"
                    src={url}
                    alt={f.name}
                    loading="lazy"
                    onClick={() => window.open(url, '_blank')}
                  />
                )
              }
              if (kind === 'video') {
                return <video key={i} className="library-video" src={url} controls preload="metadata" />
              }
              return <audio key={i} className="library-audio" src={url} controls />
            })}
          </div>
        )}
      </div>
    </div>
  )
}
