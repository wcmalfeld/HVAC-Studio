"""FastAPI application entry point: `uvicorn app.main:app`."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.middleware import BodySizeLimitMiddleware, CSRFMiddleware, RequestContextMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    app = FastAPI(
        title="HVAC Studio API",
        version="0.1.0",
        openapi_url="/api/v1/openapi.json" if settings.is_local else None,
        docs_url="/api/v1/docs" if settings.is_local else None,
        redoc_url=None,
    )
    install_error_handlers(app)

    # Starlette runs the LAST added middleware first: request-context → CORS → CSRF → body size → app.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(CSRFMiddleware)
    if settings.cors_origins:
        # Not needed in the standard setup (Next rewrites /api/* → same origin). Only for split-origin dev.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["Content-Type", "X-Requested-With", "X-Organization-Id", "X-Request-Id"],
            expose_headers=["X-Request-Id"],
        )
    app.add_middleware(RequestContextMiddleware)

    app.include_router(api_router)
    return app


app = create_app()
