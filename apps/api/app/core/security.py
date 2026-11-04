"""Password hashing (argon2), session JWTs, and an in-process rate limiter."""

from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Protocol

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()

JWT_ALGORITHM = "HS256"
MIN_PASSWORD_LENGTH = 10

# Used to equalize timing when the email does not exist.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_session_token(user_id: uuid.UUID) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=s.session_ttl_days)).timestamp()),
        "typ": "session",
    }
    return jwt.encode(payload, s.secret_key, algorithm=JWT_ALGORITHM)


def decode_session_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(
            token, get_settings().secret_key, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]}
        )
        if payload.get("typ") != "session":
            return None
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


class RateLimiter(Protocol):
    def hit(self, key: str) -> bool:
        """Record an attempt; return False if the key is over its limit."""

    def reset(self) -> None: ...


class InMemoryRateLimiter:
    """Sliding-window limiter. Single-process only; swap for a Redis-backed class when scaling out."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._hits) > 10_000:  # bound memory
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
                    del self._hits[k]
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_auth_limiter: RateLimiter | None = None


def get_auth_rate_limiter() -> RateLimiter:
    global _auth_limiter
    if _auth_limiter is None:
        s = get_settings()
        _auth_limiter = InMemoryRateLimiter(s.auth_rate_limit, s.auth_rate_window_seconds)
    return _auth_limiter


def set_auth_rate_limiter(limiter: RateLimiter) -> None:
    global _auth_limiter
    _auth_limiter = limiter
