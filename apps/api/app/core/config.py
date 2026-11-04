"""Application settings, loaded from environment (prefix-less) and an optional .env file."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]  # apps/api
# .parent.parent, not .parents[1]: in the Docker image API_ROOT is /app, which has no second parent
# (parents[1] raises IndexError at import). The image sets SAMPLE_HOUSE_PATH, so this default is unused there.
REPO_ROOT = API_ROOT.parent.parent

DEV_SECRET_KEY = "dev-insecure-secret-change-me-0123456789abcdef"
LOCAL_ENVIRONMENTS = {"development", "dev", "local", "test"}

logger = logging.getLogger("hvac.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://postgres@localhost:5432/hvac_studio"

    secret_key: str = DEV_SECRET_KEY
    session_cookie_name: str = "hvac_session"
    session_ttl_days: int = 7
    cookie_secure: bool = False
    cookie_domain: str | None = None

    csrf_header: str = "X-Requested-With"
    csrf_value: str = "hvac-studio"

    auth_rate_limit: int = 10
    auth_rate_window_seconds: int = 60

    storage_dir: Path = API_ROOT / "storage"
    max_upload_bytes: int = 25 * 1024 * 1024
    max_building_body_bytes: int = 5 * 1024 * 1024

    sample_house_path: Path = REPO_ROOT / "packages" / "shared-types" / "fixtures" / "sample-house.json"

    cors_origins: list[str] = Field(default_factory=list)
    log_level: str = "INFO"

    @field_validator("database_url", mode="after")
    @classmethod
    def _psycopg_driver(cls, v: str) -> str:
        """Hosted Postgres (Render, Heroku, …) hands out postgres:// or postgresql:// URLs, which SQLAlchemy
        maps to psycopg2 (not installed). Pin the psycopg 3 driver; explicit drivers are left untouched."""
        for scheme in ("postgres://", "postgresql://"):
            if v.startswith(scheme):
                return "postgresql+psycopg://" + v[len(scheme) :]
        return v

    @field_validator("secret_key", mode="before")
    @classmethod
    def _secret(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and not v.strip()):
            return DEV_SECRET_KEY  # empty SECRET_KEY= in .env means "unset", never an empty HMAC key
        if isinstance(v, str) and len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return v

    # Proxies whose X-Forwarded-For we trust (the Next.js server rewriting /api/* runs on loopback).
    trusted_proxies: list[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])

    @property
    def using_dev_secret(self) -> bool:
        return self.secret_key == DEV_SECRET_KEY

    @property
    def is_local(self) -> bool:
        """Only these environment names get dev conveniences; anything else is treated as deployed."""
        return self.environment.strip().lower() in LOCAL_ENVIRONMENTS


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.using_dev_secret:
        logger.warning(
            "!!!!!!!! SECRET_KEY is the built-in development default. Sessions are forgeable. "
            "Set SECRET_KEY in the environment before deploying anywhere. !!!!!!!!"
        )
        if not s.is_local:
            raise RuntimeError(f"SECRET_KEY must be set when ENVIRONMENT={s.environment!r}")
    if not s.is_local and not s.cookie_secure:
        logger.warning("Forcing COOKIE_SECURE=true for ENVIRONMENT=%r", s.environment)
        s.cookie_secure = True
    return s
