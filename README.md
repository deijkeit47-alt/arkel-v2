# Arkel V2

Assistant IA mobile (application Android via Capacitor) branché sur un backend FastAPI
qui relaie un moteur d'agent (Hermes) et un modèle DeepSeek.

## Structure

- `frontend/` — application React (Vite) → emballée en APK Android via Capacitor.
- `backend/` — backend FastAPI (`main.py`) : comptes, quota, streaming SSE, routeur
  discussion ↔ agent.

## Backend

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8787
```

Le backend attend un dossier d'identité Hermes (`arkel_home/`, avec `SOUL.md`,
`config.yaml`, et la clé API dans `.env`) — **jamais versionné**.

## Frontend

```bash
cd frontend
npm install
npm run build          # bundle web
npx cap sync android   # injecte le bundle dans l'APK
cd android && ./gradlew assembleDebug
```

L'URL du backend est configurable dans l'app : **Paramètres → Serveur**.

## Secrets

`data/` (comptes, jetons, conversations) et `.env` (clé API) sont exclus via `.gitignore`.
