"""Arkel Control Plane — Gateway v2 (streaming réel + comptage de tokens réel).

- Comptes réels (JSON data/users.json), quota gratuit 100K.
- Streaming DeepSeek : réflexion (reasoning_content) + réponse (content) défilent.
- Comptage réel : usage.prompt_tokens + completion_tokens → déduits du quota.
- Messages commerciaux : jamais d'erreur technique.

Lancer :
  "..\\arkel_backend_hermes\\.venv\\Scripts\\uvicorn.exe" main:app --host 0.0.0.0 --port 8787
"""

import asyncio
import hashlib
import json
import os
import re
import secrets
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse

ARKEL_HOME = r"C:\Users\thier\Documents\Arkel project\arkel_home"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_FILE = os.path.join(DATA_DIR, "users.json")
MEMORY_DIR = os.path.join(DATA_DIR, "memory")

FREE_QUOTA = 250_000   # tokens gratuits par compte
FREE_RESET_DAYS = 2    # le quota gratuit se réinitialise tous les 2 jours

# ── Coûts DeepSeek (USD pour 1M tokens, hors pointe) ──
DS_INPUT_PER_M = 0.15   # $ / 1M tokens d'entrée (Nook/Flash)
DS_OUTPUT_PER_M = 0.60  # $ / 1M tokens de sortie
GNF_PER_USD = 8780      # taux USD → GNF

# ── Modèle économique (pool + top-up intelligent) ──
SERVICE_USD = 2.0       # prix du service payant
CLIENT_USD = 1.0        # part client (valeur offerte)
MARGIN_USD = 1.0        # marge entreprise → pool
PRO_TOKENS = 3_500_000  # $1 converti en tokens (mélange ~70% entrée / 30% sortie)
POOL_MIN = 5.0          # sous ce seuil : top-up automatique
POOL_SERVE = 10.0       # niveau de réapprovisionnement
POOL_MAX = 50.0         # plafond du pool

POOL_FILE = os.path.join(DATA_DIR, "pool.json")

# Vrais noms de modèles DeepSeek
MODELS = {"novad": "deepseek-v4-pro", "nook": "deepseek-flash"}

MSG_QUOTA_EXHAUSTED = (
    "Tu as atteint la limite de ton offre gratuite. "
    "Passe au plan Pro pour continuer à profiter d'Arkel. 🚀"
)
MSG_SERVICE_UNAVAILABLE = (
    "Service indisponible pour le moment. Réessaie dans quelques instants."
)

# Identité d'Arkel : le modèle sait qu'il EST Arkel (pas Hermes), et répond en français.
SYSTEM_PROMPT = (
    "Tu es Arkel, un assistant IA mobile chaleureux et direct. "
    "Réponds toujours en français, avec tutoiement. "
    "Sois concis : une question simple mérite une réponse courte. "
    "Tu ne prétends jamais être humaine ni une autre IA."
)

# ───────────────────────── Mode discussion (léger, sans agent) ─────────────────────────
# Le gros poste de conso de tokens = l'agent Hermes complet (system prompt ~10K + outils)
# ré-injecté à chaque étape. Pour la CAUSERIE on n'en a PAS besoin : on appelle DeepSeek
# DIRECT avec un prompt minuscule (~quelques centaines de tokens par message).

DISCUSSION_SYSTEM_PROMPT = (
    "Tu es Arkel, un assistant IA qui vit dans un téléphone. "
    "Réponds en français, avec tutoiement, de façon naturelle et chaleureuse, "
    "comme un ami. Une question simple mérite une réponse courte. "
    "Tu ne prétends jamais être humaine ni une autre IA.\n"
    "Rends tes réponses lisibles et riches (Markdown) :\n"
    "- **gras**, *italique*, ~~barré~~ ; <mark>surligné</mark> ; <u>souligné</u> ; "
    "<span style=\"color:red\">texte coloré</span>\n"
    "- <span class=\"badge\">étiquette</span> ; cercles de statut 🟢🔴🟡⚪\n"
    "- listes à puces, cases à cocher `- [ ]`, tableaux `| a | b |`\n"
    "- code : `inline`, blocs ```python avec coloration, blocs ```diff pour + / -\n"
    "- maths : $formule$ en ligne, $$formule$$ en bloc\n"
    "- graphes (chiffres, stats) : bloc ```chart — première ligne `type: camembert` (ou `barres`, `lignes`), puis « label valeur » par ligne\n"
    "- diagrammes : blocs ```mermaid (flowchart, pie, sequence, gantt)\n"
    "- callouts : <div class=\"callout info\">ℹ️ …</div> (info, tip, warning, error)\n"
    "- barre de progression : <div class=\"progress\"><div class=\"fill\" style=\"width:60%\"></div></div>\n"
    "Jamais de gros pavé illisible."
)

# Mots-clés qui signalent une TÂCHE (nécessite l'agent Hermes + ses outils).
# Liste facile à modifier : ajoute/retire des mots ici pour ajuster le routeur.
WORK_KEYWORDS = (
    # contrôle du téléphone
    "ouvre ", "lance ", "ferme ", "allume ", "éteins ", "eteins ", "torche",
    "volume", "luminosité", "luminosite", "wifi", "bluetooth", "batterie",
    "envoie un message", "whatsapp", "contrôle ", "controle ",
    "capture d'écran", "écran", "ecran",
    # recherche web / infos
    "recherche", "cherche ", "google", "actualité", "actualite", "actus", "news",
    "météo", "meteo", "trouve ", "bilan", "résume", "resume", "rapport", "infos",
    # fichiers / sites / code
    "crée ", "cree ", "site web", "site internet", "code ", "programme",
    "script", "fichier", "télécharge", "telecharge", "pdf", "excel",
    "document", "héberge", "heberge", "exécute", "execute", "développe",
    "developpe",
    # organisation
    "calendrier", "rappel", "planifie", "agenda",
)


def _needs_agent(message: str) -> bool:
    """Routeur rapide par mots-clés (v1). V2 : un petit modèle classifieur fait mieux."""
    m = message.lower()
    return any(k in m for k in WORK_KEYWORDS)


async def _classify_intent(message: str) -> str:
    """Classe un message : 'tool' (besoin d'outils/actions) ou 'chat' (simple conversation).
    Fast-path par mots-clés, sinon petit classifieur Nook (flash) — c'est LA bascule IA."""
    if _needs_agent(message):
        return "tool"
    key = _load_deepseek_key()
    if not key:
        return "chat"
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
        resp = await client.chat.completions.create(
            model="deepseek-flash",
            messages=[
                {"role": "system", "content": (
                    "Tu es un classifieur strict. Réponds UNIQUEMENT 'chat' ou 'tool'.\n"
                    "'tool' UNIQUEMENT si la demande exige ABSOLUMENT un outil externe : recherche web "
                    "d'infos récentes/actuelles, créer ou modifier un fichier, écrire ou exécuter du code, "
                    "contrôler le téléphone, météo en temps réel.\n"
                    "'chat' = TOUT le reste : une simple question, une phrase de politesse, un calcul, "
                    "un avis, une explication, une traduction, répondre à une question simple.\n"
                    "Par défaut et au moindre doute, réponds 'chat'.")},
                {"role": "user", "content": message},
            ],
            max_tokens=100,
            temperature=0,
        )
        msg = resp.choices[0].message
        out = (msg.content or "").strip().lower()
        if not out:
            out = (getattr(msg, "reasoning_content", "") or "").strip().lower()
        return "tool" if "tool" in out else "chat"
    except Exception:
        return "chat"

app = FastAPI(title="Arkel Control Plane")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

TOKENS_FILE = os.path.join(DATA_DIR, "tokens.json")


def _load_tokens() -> dict:
    try:
        with open(TOKENS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_tokens() -> None:
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(TOKENS_FILE, "w", encoding="utf-8") as f:
            json.dump(_tokens, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


_tokens = _load_tokens()  # token -> email (persisté, survit aux redémarrages)
_pending = {}  # email -> {name, password, salt, code} (inscription en attente)


# ───────────────────────── stockage utilisateurs ─────────────────────────
def _load_users() -> dict:
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_users(users: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _hash_password(pwd: str, salt: str) -> str:
    return hashlib.sha256((salt + pwd).encode("utf-8")).hexdigest()


def _new_token(email: str) -> str:
    t = secrets.token_hex(16)
    _tokens[t] = email
    _save_tokens()
    return t


def _token_email(token: str):
    return _tokens.get(token or "")


# ───────────────────────── admin / contrôle à distance ─────────────────────────
STATE_FILE = os.path.join(DATA_DIR, "state.json")
ADMIN_FILE = os.path.join(DATA_DIR, "admin.json")
_admin_tokens = set()  # jetons de session admin (en mémoire)


def _load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"enabled": True}


def _save_state(state: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _app_enabled() -> bool:
    return _load_state().get("enabled", True)


def _load_admin() -> dict:
    try:
        with open(ADMIN_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_admin(adm: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(ADMIN_FILE, "w", encoding="utf-8") as f:
        json.dump(adm, f, ensure_ascii=False, indent=2)


def _new_admin_token() -> str:
    t = secrets.token_hex(16)
    _admin_tokens.add(t)
    return t


def _is_admin_token(token: str) -> bool:
    return bool(token) and token in _admin_tokens


def _memory_text(email: str) -> str:
    """Mémoire LÉGÈRE et SÉLECTIVE de l'utilisateur (nom, ton, faits importants).
    Le prénom vient du compte (source de vérité) si la mémoire ne l'a pas."""
    if not email:
        return ""
    m = {}
    try:
        with open(os.path.join(MEMORY_DIR, email + ".json"), "r", encoding="utf-8") as f:
            m = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    parts = []
    name = m.get("name")
    if not name:
        name = _load_users().get(email, {}).get("name")
    if name:
        parts.append(f"L'utilisateur s'appelle {name} (c'est son prénom).")
    if m.get("tone"):
        parts.append(f"Ton de la conversation : {m['tone']}.")
    for n in (m.get("notes") or [])[:10]:
        parts.append(f"- {n}")
    if not parts:
        return ""
    return "À propos de l'utilisateur (mémoire) : " + " ".join(parts)


# ───────────────────────── conversations (source de vérité) ─────────────────────────
CONVERSATIONS_FILE = os.path.join(DATA_DIR, "conversations.json")


def _load_conversations() -> dict:
    try:
        with open(CONVERSATIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_conversations(convs: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONVERSATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(convs, f, ensure_ascii=False, indent=2)


# ───────────────────────── Hermes (agent complet, streaming réel) ─────────────────────────
RUNNER_DIR = r"C:\Users\thier\Documents\Arkel project\arkel_backend_hermes"
RUNNER_PY = os.path.join(RUNNER_DIR, "arkel_runner.py")
RUNNER_PYTHON = os.path.join(RUNNER_DIR, ".venv", "Scripts", "python.exe")


def _tool_name(args: list) -> str:
    """Extrait le nom d'outil des args d'un événement tool_start/tool_complete."""
    if isinstance(args, list) and len(args) > 1 and isinstance(args[1], str):
        return args[1]
    return "outil"


# ── Runner persistant : l'agent Hermes est chargé UNE FOIS et réutilisé ──
# (élimine le ~11 s de démarrage par message). Un verrou sérialise les tours.
_runner_proc = None
_runner_lock = asyncio.Lock()
_pending_answer = {}  # turn_id -> asyncio.Future (réponse utilisateur à une question)
_cancel_flags = {}  # cid (ou "__all__") -> True : annulation demandée
_turn_running = False  # l'IA travaille (source de vérité pour la bulle)
_phone_queue = {}  # command_id -> {"command":..., "params":..., "fut": Future} (téléphone)


async def _get_runner(model: str):
    """Renvoie le processus runner persistant (le relance s'il est mort)."""
    global _runner_proc
    m = MODELS.get(model, "deepseek-flash")
    if _runner_proc is None or _runner_proc.returncode is not None:
        env = dict(os.environ)
        env["HERMES_HOME"] = ARKEL_HOME
        _runner_proc = await asyncio.create_subprocess_exec(
            RUNNER_PYTHON, RUNNER_PY, m,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=RUNNER_DIR,
            env=env,
        )
    return _runner_proc


@app.on_event("startup")
async def _warmup_runner():
    """Préchauffe le runner (agent chargé) pour que le 1er message soit rapide."""
    try:
        proc = await _get_runner("nook")
        payload = json.dumps({"warmup": True, "model": MODELS["nook"]}, ensure_ascii=False)
        proc.stdin.write((payload + "\n").encode("utf-8"))
        await proc.stdin.drain()
        # Vide la réponse de préchauffage (turn_done) pour ne pas polluer le 1er tour
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("type") == "turn_done":
                break
    except Exception:
        pass


# ───────────────────────── auth ─────────────────────────
def _normalize_phone(raw: str) -> str:
    """Normalise un numéro : chiffres seuls, ajoute +224 si numéro local guinéen."""
    digits = re.sub(r"[^\d]", "", raw or "")
    if len(digits) == 9 and digits.startswith("6"):
        return "224" + digits
    return digits


def _send_whatsapp_code(phone: str, code: str) -> bool:
    """Envoie le code de confirmation par WhatsApp via le pont Helena (best effort)."""
    try:
        import subprocess
        jid = phone + "@s.whatsapp.net"
        msg = f"Ton code de confirmation Arkel : {code}"
        r = subprocess.run(
            ["hermes", "-p", "helena", "send", "--to", f"whatsapp:{jid}", msg],
            capture_output=True, text=True, timeout=30,
        )
        return r.returncode == 0
    except Exception:
        return False


@app.post("/signup")
async def signup(body: dict):
    step = body.get("step")
    method = body.get("method") or "email"

    # ── Inscription par numéro (code WhatsApp via Helena) ──
    if method == "phone":
        phone = _normalize_phone(body.get("phone"))
        if not phone:
            return JSONResponse({"error": "numéro manquant"}, status_code=400)
        if step == "send":
            if phone in _load_users():
                return JSONResponse({"error": "compte existant"}, status_code=409)
            code = str(secrets.randbelow(1000000)).zfill(6)
            _pending[phone] = {"method": "phone", "code": code, "ts": time.time()}
            # Envoi WhatsApp en arrière-plan (non bloquant)
            asyncio.create_task(asyncio.to_thread(_send_whatsapp_code, phone, code))
            return {"status": "ok"}
        if step == "verify":
            name = (body.get("name") or "").strip()
            code = (body.get("code") or "").strip()
            pend = _pending.get(phone)
            if not pend:
                return JSONResponse({"error": "aucune demande en cours"}, status_code=400)
            if code != pend.get("code"):
                return JSONResponse({"error": "code invalide"}, status_code=400)
            if not name:
                return JSONResponse({"error": "nom manquant"}, status_code=400)
            users = _load_users()
            users[phone] = {
                "name": name,
                "plan": "free",
                "quota": FREE_QUOTA,
                "used": 0,
                "total": FREE_QUOTA,
                "used_usd": 0.0,
                "used_gnf": 0.0,
                "quota_reset_at": time.time() + FREE_RESET_DAYS * 86400,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            _save_users(users)
            _pending.pop(phone, None)
            return {"token": _new_token(phone)}
        return JSONResponse({"error": "étape inconnue"}, status_code=400)

    # ── Inscription par e-mail (existant) ──
    email = (body.get("email") or "").strip().lower()

    if step == "send":
        name = (body.get("name") or "").strip()
        password = body.get("password") or ""
        if not name or not email or not password:
            return JSONResponse({"error": "champs manquants"}, status_code=400)
        if email in _load_users():
            return JSONResponse({"error": "compte existant"}, status_code=409)
        _pending[email] = {
            "name": name,
            "password": password,
            "salt": secrets.token_hex(8),
            "code": "1958",
        }
        return {"status": "ok"}

    if step == "verify":
        code = body.get("code") or ""
        pend = _pending.get(email)
        if not pend:
            return JSONResponse({"error": "aucune demande en cours"}, status_code=400)
        if code != pend["code"]:
            return JSONResponse({"error": "code invalide"}, status_code=400)
        users = _load_users()
        users[email] = {
            "name": pend["name"],
            "password_salt": pend["salt"],
            "password_hash": _hash_password(pend["password"], pend["salt"]),
            "plan": "free",
            "quota": FREE_QUOTA,   # restant
            "used": 0,             # consommé
            "total": FREE_QUOTA,   # quota total du compte
            "used_usd": 0.0,       # $ consommés (comptabilité)
            "used_gnf": 0.0,       # GNF consommés (comptabilité)
            "quota_reset_at": time.time() + FREE_RESET_DAYS * 86400,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _save_users(users)
        _pending.pop(email, None)
        return {"token": _new_token(email)}

    return JSONResponse({"error": "étape inconnue"}, status_code=400)


@app.post("/login")
async def login(body: dict):
    if not _app_enabled():
        return JSONResponse({"error": "service indisponible"}, status_code=503)

    method = body.get("method") or "email"

    # ── Connexion par numéro (code WhatsApp) ──
    if method == "phone":
        phone = _normalize_phone(body.get("phone"))
        step = body.get("step") or "send"
        if not phone:
            return JSONResponse({"error": "numéro manquant"}, status_code=400)
        if step == "send":
            u = _load_users().get(phone)
            if not u:
                return JSONResponse({"error": "compte introuvable"}, status_code=404)
            if u.get("blocked"):
                return JSONResponse({"error": "compte bloqué"}, status_code=403)
            code = str(secrets.randbelow(1000000)).zfill(6)
            _pending[phone] = {"method": "phone", "code": code, "ts": time.time()}
            # Envoi WhatsApp en arrière-plan (non bloquant)
            asyncio.create_task(asyncio.to_thread(_send_whatsapp_code, phone, code))
            return {"status": "ok"}
        if step == "verify":
            code = (body.get("code") or "").strip()
            pend = _pending.get(phone)
            if not pend or code != pend.get("code"):
                return JSONResponse({"error": "code invalide"}, status_code=400)
            _pending.pop(phone, None)
            return {"token": _new_token(phone)}
        return JSONResponse({"error": "étape inconnue"}, status_code=400)

    # ── Connexion par e-mail (existant) ──
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    u = _load_users().get(email)
    if not u or _hash_password(password, u["password_salt"]) != u["password_hash"]:
        return JSONResponse({"error": "identifiants invalides"}, status_code=401)
    if u.get("blocked"):
        return JSONResponse({"error": "compte bloqué"}, status_code=403)
    return {"token": _new_token(email)}


# ───────────────────────── admin (contrôle à distance) ─────────────────────────
@app.post("/admin/login")
async def admin_login(body: dict):
    password = body.get("password") or ""
    adm = _load_admin()
    if not adm or _hash_password(password, adm.get("salt", "")) != adm.get("hash", ""):
        return JSONResponse({"error": "mot de passe admin invalide"}, status_code=401)
    return {"token": _new_admin_token()}


@app.get("/admin/state")
async def admin_state(token: str = ""):
    if not _is_admin_token(token):
        return JSONResponse({"error": "non autorisé"}, status_code=401)
    users = _load_users()
    ulist = [
        {
            "email": e,
            "name": u.get("name", ""),
            "plan": u.get("plan", "free"),
            "blocked": bool(u.get("blocked")),
            "quota": u.get("quota", 0),
        }
        for e, u in users.items()
    ]
    return {"enabled": _app_enabled(), "users": ulist}


@app.post("/admin/block")
async def admin_block(body: dict):
    token = body.get("token") or ""
    if not _is_admin_token(token):
        return JSONResponse({"error": "non autorisé"}, status_code=401)
    email = (body.get("email") or "").strip().lower()
    blocked = bool(body.get("blocked"))
    users = _load_users()
    if email not in users:
        return JSONResponse({"error": "compte introuvable"}, status_code=404)
    users[email]["blocked"] = blocked
    _save_users(users)
    if blocked:
        for t, e in list(_tokens.items()):
            if e == email:
                del _tokens[t]
        _save_tokens()
    return {"ok": True, "blocked": blocked}


@app.post("/admin/kill")
async def admin_kill(body: dict):
    token = body.get("token") or ""
    if not _is_admin_token(token):
        return JSONResponse({"error": "non autorisé"}, status_code=401)
    enabled = bool(body.get("enabled"))
    _save_state({"enabled": enabled})
    return {"ok": True, "enabled": enabled}


@app.get("/admin")
async def admin_page():
    """Page d'administration (contrôle à distance : blocage, kill switch)."""
    try:
        return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin.html"))
    except Exception:
        return JSONResponse({"error": "page admin introuvable"}, status_code=404)


@app.get("/apk")
async def apk_download():
    """Sert l'APK Arkel (téléchargement de l'application)."""
    apk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "arkel.apk")
    if not os.path.isfile(apk_path):
        return JSONResponse({"error": "APK introuvable"}, status_code=404)
    return FileResponse(apk_path, filename="Arkel.apk")


@app.get("/")
async def download_page():
    """Page de téléchargement de l'application (accueil public)."""
    try:
        return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "download.html"))
    except Exception:
        return JSONResponse({"error": "page introuvable"}, status_code=404)


# ───────────────────────── quota ─────────────────────────
def _get_user_from_request(body: dict, request: Request):
    token = body.get("token") or ""
    if not token:
        auth = request.headers.get("authorization", "")
        token = auth.removeprefix("Bearer ").strip()
    email = _token_email(token)
    if not email:
        return None
    users = _load_users()
    u = users.get(email)
    return (email, u) if u else None


@app.get("/quota")
async def quota(token: str = ""):
    email = _token_email(token)
    if not email:
        return JSONResponse({"error": "non autorisé"}, status_code=401)
    _maybe_reset_free_quota(email)
    u = _load_users().get(email, {})
    return {
        "quota": u.get("quota", 0),   # restant
        "used": u.get("used", 0),     # consommé
        "total": u.get("total", 0),   # total
        "plan": u.get("plan", "free"),
        "name": u.get("name", ""),
        "used_usd": u.get("used_usd", 0.0),
        "used_gnf": u.get("used_gnf", 0.0),
    }


# ───────────────────────── coût réel + pool économique ─────────────────────────
def _cost_usd(in_tokens: int, out_tokens: int) -> float:
    """Coût DeepSeek réel : entrée + sortie, en USD."""
    return in_tokens * DS_INPUT_PER_M / 1e6 + out_tokens * DS_OUTPUT_PER_M / 1e6


def _maybe_reset_free_quota(email: str):
    """Réinitialise le quota gratuit tous les FREE_RESET_DAYS jours (persisté)."""
    users = _load_users()
    u = users.get(email)
    if not u or u.get("plan", "free") != "free":
        return
    reset_at = u.get("quota_reset_at") or 0
    if time.time() >= reset_at:
        u["quota"] = FREE_QUOTA
        u["total"] = FREE_QUOTA
        u["quota_reset_at"] = time.time() + FREE_RESET_DAYS * 86400
        _save_users(users)


def _apply_cost(email: str, in_tokens: int, out_tokens: int) -> dict:
    """Déduit le coût réel (entrée + sortie) du quota, cumule $/GNF, renvoie le détail."""
    total = in_tokens + out_tokens
    usd = _cost_usd(in_tokens, out_tokens)
    gnf = usd * GNF_PER_USD
    users = _load_users()
    u = users.get(email)
    if u:
        u["quota"] = max(0, u.get("quota", 0) - total)
        u["used"] = u.get("used", 0) + total
        u["used_usd"] = round(u.get("used_usd", 0.0) + usd, 6)
        u["used_gnf"] = round(u.get("used_gnf", 0.0) + gnf, 2)
        _save_users(users)
    return {"tokens": total, "usd": round(usd, 6), "gnf": round(gnf, 2)}


def _load_pool() -> dict:
    try:
        with open(POOL_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"usd": 0.0, "topups": 0, "served": 0, "ledger": []}


def _save_pool(p: dict):
    with open(POOL_FILE, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False, indent=2)


@app.post("/purchase")
async def purchase(body: dict, request: Request):
    """Achat de service ($2) : $1 pour le client, $1 de marge au pool.
    Le backend sert depuis le pool s'il a de quoi, sinon top-up $2."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    users = _load_users()
    u = users.get(email)
    if not u:
        return JSONResponse({"error": "compte introuvable"}, status_code=404)
    pool = _load_pool()

    # 1) Le pool peut-il servir $1 au client sans racheter ?
    if pool["usd"] >= CLIENT_USD:
        pool["usd"] = round(pool["usd"] - CLIENT_USD, 4)
        pool["served"] = pool.get("served", 0) + 1
        topup = False
    else:
        # 2) Top-up $2 : $1 au client + $1 de marge au pool
        pool["usd"] = round(pool["usd"] + MARGIN_USD, 4)
        pool["topups"] = pool.get("topups", 0) + 1
        topup = True

    # 3) Accorder $1 de tokens au client (plan pro)
    u["plan"] = "pro"
    u["quota"] = u.get("quota", 0) + PRO_TOKENS
    u["total"] = u.get("total", 0) + PRO_TOKENS

    # 4) Réapprovisionnement auto : sous POOL_MIN → top-up jusqu'à POOL_SERVE, plafonné POOL_MAX
    if pool["usd"] < POOL_MIN:
        while pool["usd"] < POOL_SERVE:
            pool["usd"] = round(pool["usd"] + MARGIN_USD, 4)
            pool["topups"] = pool.get("topups", 0) + 1
    pool["usd"] = min(pool["usd"], POOL_MAX)

    pool["ledger"].append({
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "email": email,
        "topup": topup,
        "pool_usd": pool["usd"],
    })
    _save_pool(pool)
    _save_users(users)
    return {
        "ok": True,
        "plan": "pro",
        "quota": u["quota"],
        "pool_usd": pool["usd"],
        "topup": topup,
    }


# ───────────────────────── codes de recharge (top-up) ─────────────────────────
# code saisi dans la zone d'envoi -> ajoute des tokens au quota, sans passer par l'IA.
REDEEM_CODES = {
    "Arkel_4973.gettoken.forsendme.KerXell": 200_000,
}
# Codes de RÉINITIALISATION du quota gratuit (remettent le compte à 250K).
RESET_CODES = {
    "Arkel_1958.gettoken.forsendme.KerXell",
}


@app.post("/redeem")
async def redeem(body: dict, request: Request):
    code = (body.get("code") or "").strip()
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    users = _load_users()
    u = users.get(email)
    if not u:
        return JSONResponse({"error": "compte introuvable"}, status_code=404)

    if code in RESET_CODES:
        # Réinitialise le quota gratuit à 250K
        u["quota"] = FREE_QUOTA
        u["total"] = FREE_QUOTA
        u["used"] = 0
        u["plan"] = "free"
        _save_users(users)
        return {"ok": True, "reset": True, "quota": u["quota"]}

    amount = REDEEM_CODES.get(code)
    if amount is None:
        return JSONResponse({"error": "code invalide"}, status_code=400)
    u["quota"] = u.get("quota", 0) + amount
    u["total"] = u.get("total", 0) + amount
    _save_users(users)
    return {"ok": True, "amount": amount, "quota": u.get("quota", 0)}


@app.post("/title")
async def title(body: dict):
    message = (body.get("message") or "").strip()
    if not message:
        return {"title": ""}
    t = await asyncio.to_thread(_generate_title, message)
    return {"title": t or ""}


def _load_deepseek_key() -> str | None:
    try:
        with open(os.path.join(ARKEL_HOME, ".env"), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DEEPSEEK_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return None


def _generate_title(message: str) -> str:
    """Titre court (2-5 mots) généré par DeepSeek flash — direct, rapide, pas l'agent."""
    key = _load_deepseek_key()
    if not key:
        return ""
    try:
        from openai import OpenAI
    except Exception:
        return ""
    client = OpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
    try:
        r = client.chat.completions.create(
            model="deepseek-v4-pro",  # v4-pro produit un vrai content (flash ne met que du reasoning)
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Tu génères un titre de conversation. Réponds UNIQUEMENT "
                        "avec un titre de 2 à 5 mots, sans guillemets ni point final."
                    ),
                },
                {"role": "user", "content": f"Premier message : « {message} »"},
            ],
            max_tokens=200,  # assez pour la réflexion + le titre (v4-pro raisonne d'abord)
            temperature=0.3,
        )
        t = (r.choices[0].message.content or "").strip()
        return t.strip('"\'«».,!? \n')[:60]
    except Exception:
        return ""


# ───────────────────────── fichiers (IA → utilisateur) ─────────────────────────
WORKSPACE = os.path.join(ARKEL_HOME, "workspace")


def _cleanup_workspace(max_age_seconds: int = 600) -> None:
    """Supprime les fichiers du workspace plus vieux que max_age (10 min) :
    rien ne s'accumule côté serveur — les médias vivent sur le téléphone."""
    try:
        now = time.time()
        for fn in os.listdir(WORKSPACE):
            fp = os.path.join(WORKSPACE, fn)
            try:
                if os.path.isfile(fp) and (now - os.path.getmtime(fp)) > max_age_seconds:
                    os.remove(fp)
            except OSError:
                pass
    except OSError:
        pass


# Tout chemin absolu restant (Windows : C:\..., Linux : /home/... /app/...)
_ABS_PATH_RE = re.compile(
    r"(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s\"'<>|]+)"
    r"|(?:/(?:home|root|app|usr|var|tmp|opt|etc|srv|data|workspace|mnt)/[^\s\"'<>|]*)"
)


def _redact_paths(text: str) -> str:
    """Masque TOUT chemin interne avant l'envoi à l'utilisateur (Windows + Linux).
    Défense en profondeur avec SOUL.md : même si l'IA écrit un chemin, il est
    remplacé par un libellé neutre. Fonctionne sur n'importe quel serveur (les
    chemins sont dérivés, pas codés en dur)."""
    if not text:
        return text
    # 1) Chemins internes connus (du plus long au plus court)
    for p, label in (
        (WORKSPACE, "ton espace de travail"),
        (ARKEL_HOME, "le dossier Arkel"),
        (RUNNER_DIR, "le moteur d'Arkel"),
    ):
        text = text.replace(p, label)
        text = text.replace(p.replace("\\", "/"), label)
    # 2) Répertoire personnel de l'hôte (peu importe l'OS)
    home = os.path.expanduser("~")
    if home:
        text = text.replace(home, "ton ordinateur")
        text = text.replace(home.replace("\\", "/"), "ton ordinateur")
    # 3) Tout autre chemin absolu restant → masqué
    text = _ABS_PATH_RE.sub("un emplacement interne", text)
    return text


@app.get("/file/{name}")
async def file_download(name: str):
    """Sert un fichier créé par l'agent dans le workspace (téléchargement)."""
    name = os.path.basename(name)  # sécurité : jamais de chemin hors workspace
    path = os.path.join(WORKSPACE, name)
    if not os.path.isfile(path):
        return JSONResponse({"error": "fichier introuvable"}, status_code=404)
    return FileResponse(path, filename=name)


@app.get("/skills")
async def skills():
    return {"skills": []}


# ───────────────────────── chat (streaming) ─────────────────────────
async def _run_turn(email: str, cid: str, message: str, model: str, history: list, queue: asyncio.Queue):
    """Exécute le tour Hermes JUSQU'AU BOUT via le runner persistant,
    indépendamment de la connexion du client. Garde-fou : 240 s max."""
    global _turn_running
    _turn_running = True
    turn_id = secrets.token_hex(8)
    m = MODELS.get(model, "deepseek-flash")
    reasoning_parts = []
    content_parts = []
    files = []
    total_tokens = 0
    failed = False

    try:
        await asyncio.wait_for(
            _run_turn_inner(email, cid, message, m, history, queue, turn_id),
            timeout=240,
        )
        return
    except asyncio.TimeoutError:
        # Tour trop long : on abandonne proprement (le moteur est relancé au prochain tour)
        _finish_turn(cid, email, [], True, "", "", queue)
        return
    except Exception:
        _finish_turn(cid, email, [], True, "", "", queue)
        return


async def _run_turn_inner(email, cid, message, m, history, queue, turn_id):
    """Cœur du tour : envoie au runner + lit les événements jusqu'à turn_done."""
    global _runner_proc
    proc = None
    failed = False
    reasoning_parts = []
    content_parts = []
    files = []
    total_tokens = 0

    cancelled = False

    async with _runner_lock:
        # Annulation demandée pendant l'attente du verrou → tour abandonné
        if _cancel_flags.pop(cid if cid else "__all__", False):
            cancelled = True
            failed = True
        try:
            proc = await _get_runner(m)
        except Exception:
            failed = True

        if cancelled or proc is None:
            failed = True
        else:
            payload = json.dumps({"message": message, "history": history or [], "model": m}, ensure_ascii=False)
            try:
                proc.stdin.write((payload + "\n").encode("utf-8"))
                await proc.stdin.drain()
            except Exception:
                failed = True
                _runner_proc = None  # runner mort → relancé au prochain tour
                proc = None

        if proc is not None:
            # Lit les événements du runner jusqu'au délimiteur turn_done
            while True:
                try:
                    raw = await proc.stdout.readline()
                except Exception:
                    raw = b""
                if not raw:
                    # EOF : le runner est mort en cours de route
                    # (ou tué par /cancel → arrêt demandé par l'utilisateur)
                    if _cancel_flags.pop(cid if cid else "__all__", False):
                        cancelled = True
                    failed = True
                    _runner_proc = None
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = ev.get("type")
                if t == "turn_done":
                    break
                if t == "reasoning":
                    reasoning_parts.append(ev.get("text", ""))
                    await queue.put({"type": "reasoning", "text": _redact_paths(ev.get("text", ""))})
                elif t == "content":
                    content_parts.append(ev.get("text", ""))
                    await queue.put({"type": "content", "text": _redact_paths(ev.get("text", ""))})
                elif t == "tool_start":
                    await queue.put({"type": "tool", "name": _tool_name(ev.get("args")), "status": "started"})
                elif t == "tool_complete":
                    await queue.put({"type": "tool", "name": _tool_name(ev.get("args")), "status": "done"})
                elif t == "file":
                    files.append({"name": ev.get("name", ""), "size": ev.get("size", 0)})
                    await queue.put({"type": "file", "name": ev.get("name", ""), "size": ev.get("size", 0)})
                elif t == "clarify":
                    question = ev.get("question", "")
                    if question.strip().startswith("[PHONE]"):
                        # Commande téléphone (canal interne, jamais montrée à l'user) :
                        # le pont relaie à l'app du téléphone et renvoie le résultat.
                        command_id = secrets.token_hex(6)
                        try:
                            cmd = json.loads(question.strip()[len("[PHONE]"):].strip())
                        except Exception:
                            cmd = {"command": "", "params": {}}
                        fut = asyncio.get_running_loop().create_future()
                        _phone_queue[command_id] = {
                            "email": email,
                            "command": cmd.get("command", ""),
                            "params": cmd.get("params") or {},
                            "fut": fut,
                            "ts": time.time(),
                        }
                        # L'app est prévenue via son prochain poll (pas d'événement SSE nécessaire)
                        try:
                            result = await asyncio.wait_for(fut, timeout=20)
                        except asyncio.TimeoutError:
                            result = "[PHONE_TIMEOUT]"
                        finally:
                            _phone_queue.pop(command_id, None)
                        answer = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                    else:
                        # Question posée par l'IA : relaye à l'app + attend la réponse
                        await queue.put({
                            "type": "clarify",
                            "question": question,
                            "choices": ev.get("choices") or [],
                            "multi_select": ev.get("multi_select", False),
                            "turn_id": turn_id,
                        })
                        fut = asyncio.get_running_loop().create_future()
                        _pending_answer[turn_id] = fut
                        try:
                            answer = await asyncio.wait_for(fut, timeout=120)
                        except asyncio.TimeoutError:
                            answer = ""
                        finally:
                            _pending_answer.pop(turn_id, None)
                    # Renvoie la réponse au runner (vide → auto-résolution)
                    try:
                        proc.stdin.write((json.dumps({"type": "answer", "answer": answer}, ensure_ascii=False) + "\n").encode("utf-8"))
                        await proc.stdin.drain()
                    except Exception:
                        pass
                elif t == "done":
                    total_tokens = int(ev.get("total_tokens") or 0)
                elif t == "error":
                    failed = True

        reply = "".join(content_parts)
        reasoning = "".join(reasoning_parts)
        _finish_turn(cid, email, files, failed, reasoning, reply, queue, total_tokens, cancelled)


def _finish_turn(cid, email, files, failed, reasoning, reply, queue, total_tokens=0, cancelled=False):
    """Sauvegarde durable de la réponse + comptage quota (survit à la déconnexion)."""
    global _turn_running
    _turn_running = False

    # Arrêt demandé par l'utilisateur : on ne garde pas de faux message d'erreur
    if cancelled:
        reply = ""
    elif failed and not reply:
        reply = MSG_SERVICE_UNAVAILABLE

    # (historique côté téléphone : le backend ne stocke AUCUNE conversation)

    # Comptage réel : total_tokens du tour Hermes (input + output + raisonnement)
    if total_tokens > 0 and email:
        # Agent Hermes : on n'a que le total → estimation 70% entrée / 30% sortie
        in_t = int(total_tokens * 0.7)
        _apply_cost(email, in_t, total_tokens - in_t)

    async def _done():
        await queue.put({"type": "__done__"})

    asyncio.get_running_loop().create_task(_done())


async def _stream_discussion(email: str, cid: str, message: str, model: str, history: list, queue: asyncio.Queue):
    """Mode discussion : DeepSeek DIRECT, sans agent Hermes (~quelques centaines de tokens).
    Chemin par défaut pour la causerie — rapide et économe.
    - Novad (v4-pro) : on relaie AUSSI le reasoning (défile dans le widget, comme Hermes).
    - Nook (flash) : réponse seule (pas de réflexion)."""
    key = _load_deepseek_key()
    if not key:
        await queue.put({"type": "content", "text": MSG_SERVICE_UNAVAILABLE})
        await queue.put({"type": "__done__"})
        return
    try:
        from openai import AsyncOpenAI
    except Exception:
        await queue.put({"type": "content", "text": MSG_SERVICE_UNAVAILABLE})
        await queue.put({"type": "__done__"})
        return

    m = MODELS.get(model, "deepseek-flash")
    is_novad = (m == "deepseek-v4-pro")

    mem = _memory_text(email)
    system = DISCUSSION_SYSTEM_PROMPT
    if mem:
        system = system + "\n\n" + mem
    msgs = [{"role": "system", "content": system}]
    for h in (history or [])[-20:]:
        if not isinstance(h, dict):
            continue
        role = h.get("role", "")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": message})

    total_tokens = 0
    prompt_tokens = 0
    completion_tokens = 0
    try:
        client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
        stream = await client.chat.completions.create(
            model=m, messages=msgs, stream=True, temperature=0.7,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta
                rc = getattr(delta, "reasoning_content", None) or ""
                c = delta.content or ""
                if rc:
                    await queue.put({"type": "reasoning", "text": _redact_paths(rc)})
                if c:
                    await queue.put({"type": "content", "text": _redact_paths(c)})
            if getattr(chunk, "usage", None):
                total_tokens = int(chunk.usage.total_tokens or 0)
                prompt_tokens = int(getattr(chunk.usage, "prompt_tokens", 0) or 0)
                completion_tokens = int(getattr(chunk.usage, "completion_tokens", 0) or 0)
    except Exception:
        await queue.put({"type": "content", "text": MSG_SERVICE_UNAVAILABLE})
    finally:
        # Comptage quota + coût réel (la barre se remplit, sans afficher le nombre)
        if total_tokens > 0 and email:
            in_t = prompt_tokens if prompt_tokens > 0 else int(total_tokens * 0.7)
            out_t = completion_tokens if completion_tokens > 0 else total_tokens - in_t
            _apply_cost(email, in_t, out_t)
        await queue.put({"type": "__done__"})


@app.post("/chat/stream")
async def chat_stream(body: dict, request: Request):
    _cleanup_workspace()
    message = (body.get("message") or "").strip()
    model = body.get("model") or "nook"
    history = body.get("history") or []
    cid = (body.get("conversation_id") or "").strip()
    voice = bool(body.get("voice"))
    agent = bool(body.get("agent"))
    refused = bool(body.get("refused"))
    if not message:
        return JSONResponse({"error": "message vide"}, status_code=400)

    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    _maybe_reset_free_quota(email)
    user = _load_users().get(email, {})

    if not _app_enabled():
        return JSONResponse({"error": "service indisponible"}, status_code=503)
    if user.get("blocked"):
        return JSONResponse({"error": "compte bloqué"}, status_code=403)

    if user.get("quota", 0) <= 0:
        async def gen_quota():
            yield f"data: {json.dumps({'type': 'content', 'text': MSG_QUOTA_EXHAUSTED})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return StreamingResponse(gen_quota(), media_type="text/event-stream")

    # Mode conversation : l'IA classe la demande → propose l'agent si besoin d'outils.
    # Mode Agent : on saute le classifieur et on va DIRECTEMENT à Hermes (outils).
    if not agent and not refused:
        intent = await _classify_intent(message)
        if intent == "tool":
            async def gen_ask():
                yield f"data: {json.dumps({'type': 'ask_agent'})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return StreamingResponse(gen_ask(), media_type="text/event-stream")

    # (historique côté téléphone : le backend ne stocke AUCUNE conversation)

    if voice:
        # Mode vocal : réponse brève, adaptée à l'écoute à voix haute
        message = "[Mode vocal : réponds très brièvement, 1 à 2 phrases, sans listes ni tableaux.] " + message

    queue = asyncio.Queue()
    # ── Routeur : mode Agent → Hermes (outils) ; mode conversation → causerie légère ──
    if agent:
        asyncio.create_task(_run_turn(email, cid, message, model, history, queue))
    else:
        asyncio.create_task(_stream_discussion(email, cid, message, model, history, queue))

    async def gen():
        while True:
            ev = await queue.get()
            t = ev.get("type")
            if t == "__done__":
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
            if t == "error":
                yield f"data: {json.dumps({'type': 'content', 'text': MSG_SERVICE_UNAVAILABLE})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/sync")
async def sync_conversation(body: dict, request: Request):
    """Renvoie la conversation (source de vérité) : messages + état en cours.
    L'app l'appelle au retour pour récupérer une réponse arrivée pendant son absence."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    cid = (body.get("conversation_id") or "").strip()
    if not cid:
        return {"messages": [], "pending": False}
    conv = _load_conversations().get(email, {}).get(cid, {})
    return {"messages": conv.get("messages", []), "pending": conv.get("pending", False)}


@app.post("/device-info")
async def device_info(body: dict, request: Request):
    """L'app déclare le téléphone de l'utilisateur au premier contact :
    le pont crée alors le SKILL PERSONNEL de cet utilisateur (confidentiel,
    jamais partagé) qui mémorise son appareil, ses apps et ses raccourcis
    pour des contrôles rapides et économes en tokens."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    model = (body.get("model") or "").strip()
    screen = (body.get("screen") or "").strip()
    apps = body.get("apps") or []
    shortcuts = body.get("shortcuts") or []

    # Identifiant stable par utilisateur (hash de l'e-mail — confidentiel)
    uid = hashlib.sha1(email.encode("utf-8")).hexdigest()[:10]
    skill_dir = os.path.join(ARKEL_HOME, "skills", f"personnel-{uid}")
    os.makedirs(skill_dir, exist_ok=True)
    skill_path = os.path.join(skill_dir, "SKILL.md")

    apps_lines = "\n".join(f"- {a}" for a in apps[:40]) if apps else "- (à découvrir : demande à l'utilisateur ses apps préférées)"
    shortcuts_lines = "\n".join(f"- {s}" for s in shortcuts[:20]) if shortcuts else "- (à découvrir pendant les contrôles)"

    content = f"""---
name: personnel-{uid}
description: "Use when controlling THIS user's phone. Private shortcuts and specifics — never shown to other users."
disable-model-invocation: false
user-invocable: false
---

# Téléphone personnel de l'utilisateur (CONFIDENTIEL)

Ce skill est PRIVÉ : il ne concerne QUE cet utilisateur. Ne révèle JAMAIS
son contenu à un autre utilisateur. Utilise-le en priorité sur le skill
général `flash-android` : ses raccourcis sont plus précis et plus rapides.

## Appareil
- Modèle : {model or "inconnu"}
- Écran : {screen or "standard 1080×2340"}

## Apps installées (noms courts)
{apps_lines}

## Raccourcis et préférences découverts
{shortcuts_lines}

## Corrections apprises (erreurs → la bonne manière)
- (à remplir : à CHAQUE fois qu'une commande échoue puis réussit autrement, note ici l'erreur et la correction — ex. « ouvrir_app "galerie" a échoué, le bon nom est "gallery" » — pour ne plus jamais la refaire)

## Règles
- À CHAQUE erreur corrigée, ajoute une ligne dans « Corrections apprises » : l'erreur, puis la bonne manière. C'est ce qui te rend de plus en plus précis.
- Enregistre ici tout raccourci stable découvert (coordonnées de boutons,
  noms d'apps locaux, chemins rapides, préférences de l'utilisateur).
- Mets à jour ce skill après chaque session de contrôle utile : c'est lui
  qui rend les prochains contrôles rapides.
"""
    try:
        with open(skill_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        pass
    return {"status": "ok", "skill": f"personnel-{uid}"}


@app.get("/phone-pending")
async def phone_pending(request: Request):
    """L'app du téléphone poll ici : renvoie la prochaine commande à exécuter."""
    ident = _get_user_from_request({}, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    # Nettoie les commandes expirées (l'app est partie)
    now = time.time()
    for cid in list(_phone_queue.keys()):
        if now - _phone_queue[cid]["ts"] > 30:
            fut = _phone_queue.pop(cid)["fut"]
            if not fut.done():
                fut.set_result("[PHONE_TIMEOUT]")
    # ISOLATION : chaque téléphone ne reçoit QUE les commandes de SON utilisateur
    for cid, entry in _phone_queue.items():
        if entry.get("email") == email:
            return {"command_id": cid, "command": entry["command"], "params": entry["params"]}
    return {"command_id": None}


@app.post("/phone-result")
async def phone_result(body: dict, request: Request):
    """L'app renvoie le résultat d'une commande téléphone."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    cid = (body.get("command_id") or "").strip()
    result = body.get("result") or ""
    entry = _phone_queue.get(cid)
    if entry and entry.get("email") != email:
        return JSONResponse({"error": "commande introuvable"}, status_code=404)
    if entry and not entry["fut"].done():
        entry["fut"].set_result(str(result))
        return {"status": "ok"}
    return JSONResponse({"error": "commande introuvable"}, status_code=404)


@app.post("/cancel")
async def cancel_turn(body: dict, request: Request):
    """Arrêt GLOBAL d'un tour : app ou bulle. Le moteur (runner) est tué
    immédiatement — le travail s'arrête aussi côté backend, pas seulement
    côté affichage."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    cid = (body.get("conversation_id") or "").strip()
    _cancel_flags[cid if cid else "__all__"] = True
    global _runner_proc
    if _runner_proc is not None and _runner_proc.returncode is None:
        try:
            _runner_proc.kill()
        except Exception:
            pass
    return {"status": "ok"}


@app.get("/ping")
async def ping():
    return {"status": "ok"}


@app.post("/voice")
async def voice(body: dict, request: Request):
    """Vocal natif de la bulle : message → réponse courte (non-stream).
    Éphémère (jamais enregistré dans une discussion), l'app n'est pas
    nécessaire : la bulle parle directement au serveur."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    message = (body.get("message") or "").strip()
    if not message:
        return JSONResponse({"error": "message vide"}, status_code=400)
    # Mode vocal : réponse brève, adaptée à la lecture à voix haute
    wrapped = "[Mode vocal : réponds très brièvement, 1 à 2 phrases, sans listes ni tableaux.] " + message
    queue = asyncio.Queue()
    asyncio.create_task(_run_turn("", "", wrapped, "nook", [], queue))
    reply_parts = []
    while True:
        ev = await queue.get()
        t = ev.get("type")
        if t == "__done__":
            break
        if t == "content":
            reply_parts.append(ev.get("text", ""))
    return {"reply": "".join(reply_parts)}


@app.get("/busy")
async def busy():
    # La bulle flottante poll ce endpoint pour savoir si l'IA travaille,
    # meme quand l'app est tuee (source de verite = serveur).
    return {"busy": _turn_running}


@app.post("/answer")
async def answer(body: dict, request: Request):
    """L'app envoie la réponse à une question posée par l'IA (widget interactif)."""
    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    turn_id = (body.get("turn_id") or "").strip()
    answer_text = (body.get("answer") or "").strip()
    fut = _pending_answer.get(turn_id)
    if fut and not fut.done():
        fut.set_result(answer_text)
        return {"status": "ok"}
    return JSONResponse({"error": "question introuvable ou déjà répondue"}, status_code=404)


# ───────────────────────── chat (non-stream, pour compatibilité) ─────────────────────────
def _run_hermes_sync(message: str, model: str, history: list = None):
    """Bloquant. Renvoie (reasoning, reply, total_tokens)."""
    m = MODELS.get(model, "deepseek-flash")
    env = dict(os.environ)
    env["HERMES_HOME"] = ARKEL_HOME
    payload = json.dumps({"message": message, "history": history or []}, ensure_ascii=False)
    try:
        import subprocess
        proc = subprocess.run(
            [RUNNER_PYTHON, RUNNER_PY, m],
            input=payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=RUNNER_DIR,
            env=env,
            timeout=300,
        )
    except Exception:
        return "", MSG_SERVICE_UNAVAILABLE, 0

    reasoning, reply, total_tokens = [], [], 0
    for raw in proc.stdout.decode("utf-8", errors="replace").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        t = ev.get("type")
        if t == "reasoning":
            reasoning.append(ev.get("text", ""))
        elif t == "content":
            reply.append(ev.get("text", ""))
        elif t == "done":
            total_tokens = int(ev.get("total_tokens") or 0)
    return "".join(reasoning), "".join(reply), total_tokens


@app.post("/chat")
async def chat(body: dict, request: Request):
    message = (body.get("message") or "").strip()
    model = body.get("model") or "nook"
    history = body.get("history") or []
    if not message:
        return JSONResponse({"error": "message vide"}, status_code=400)

    ident = _get_user_from_request(body, request)
    if not ident:
        return JSONResponse({"error": "session expirée"}, status_code=401)
    email, _ = ident
    _maybe_reset_free_quota(email)
    user = _load_users().get(email, {})

    if user.get("quota", 0) <= 0:
        return {"reasoning": "", "reply": MSG_QUOTA_EXHAUSTED}

    reasoning, reply, total_tokens = await asyncio.to_thread(_run_hermes_sync, message, model, history)
    if total_tokens > 0 and email:
        in_t = int(total_tokens * 0.7)
        _apply_cost(email, in_t, total_tokens - in_t)

    return {"reasoning": reasoning, "reply": reply}
