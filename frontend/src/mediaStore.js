// mediaStore.js — stockage local des médias (IndexedDB), côté téléphone.
// Les fichiers créés par l'agent sont téléchargés ici : rien ne reste sur le PC.

const DB_NAME = 'arkel-media'
const STORE = 'files'

// Cache d'URL d'objet en mémoire (affichage immédiat, sans recréer l'URL).
const urlCache = new Map()

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Enregistre un blob sur le téléphone (persistant, survit au redémarrage).
export async function saveMedia(name, blob, size) {
  const u = URL.createObjectURL(blob)
  urlCache.set(name, u)
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ name, blob, size: size || blob.size, ts: Date.now() })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (_) {}
  return u
}

// Lit un blob depuis IndexedDB et renvoie une URL d'objet (ou null).
export async function getMediaUrl(name) {
  if (urlCache.has(name)) return urlCache.get(name)
  try {
    const db = await openDB()
    const rec = await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(name)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
    if (rec) {
      const u = URL.createObjectURL(rec.blob)
      urlCache.set(name, u)
      return u
    }
  } catch (_) {}
  return null
}

// Liste tous les médias stockés (pour la bibliothèque).
export async function listMedia() {
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result || []).map((r) => ({ name: r.name, size: r.size, ts: r.ts })))
      req.onerror = () => resolve([])
    })
  } catch (_) {
    return []
  }
}
