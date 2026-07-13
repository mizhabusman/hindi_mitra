"""
Password hashing and signed-session tokens.

Sessions are stateless signed cookies (itsdangerous). The issue time is
validated **server-side** against a max age, so an old cookie is rejected even
if the browser keeps sending it.
"""
from __future__ import annotations

import time

import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings

_settings = get_settings()
_serializer = URLSafeTimedSerializer(_settings.effective_secret_key(), salt="hindimitra.session")


# ── Passwords ────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    # bcrypt caps the input at 72 bytes; truncate explicitly so long
    # passphrases behave predictably.
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    pw = password.encode("utf-8")[:72]
    try:
        return bcrypt.checkpw(pw, hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


# ── Session tokens ───────────────────────────────────────────────────
def issue_session(user_id: int) -> str:
    """Create a signed session token for a user."""
    return _serializer.dumps({"uid": user_id, "iat": int(time.time())})


def read_session(token: str) -> int | None:
    """
    Return the user id from a valid, unexpired token, else None.

    Expiry is enforced here (max_age) — the signature carries a trusted
    timestamp, so a stale token is rejected regardless of the cookie's max-age.
    """
    try:
        data = _serializer.loads(token, max_age=_settings.session_ttl_seconds)
    except (BadSignature, SignatureExpired):
        return None
    uid = data.get("uid")
    return uid if isinstance(uid, int) else None
