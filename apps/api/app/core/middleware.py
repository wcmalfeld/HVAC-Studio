"""Pure-ASGI middleware: request id + access log, CSRF header check, request body size limit."""

from __future__ import annotations

import json
import logging
import re
import time
import uuid

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.errors import envelope

access_log = logging.getLogger("hvac.access")

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
REQUEST_ID_HEADER = "X-Request-Id"
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_UPLOAD_PATH_RE = re.compile(r"^/api/v1/projects/[^/]+/drawings/?$")
MULTIPART_OVERHEAD = 1024 * 1024


async def _send_json(send: Send, status: int, body: dict, extra_headers: list[tuple[bytes, bytes]] | None = None):
    payload = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
    await send({"type": "http.response.start", "status": status, "headers": headers + (extra_headers or [])})
    await send({"type": "http.response.body", "body": payload})


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers", []):
        if k.lower() == name:
            return v.decode("latin-1")
    return None


class RequestContextMiddleware:
    """Assigns/propagates X-Request-Id and writes one access-log line per request."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = _header(scope, b"x-request-id")
        request_id = incoming if incoming and _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        start = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.lower().encode(), request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            access_log.info(
                "%s %s %s %.1fms rid=%s",
                scope["method"],
                scope["path"],
                status_holder["status"],
                (time.perf_counter() - start) * 1000,
                request_id,
            )


class CSRFMiddleware:
    """Rejects state-changing requests lacking `X-Requested-With: hvac-studio` (ADR-003).

    Browsers cannot attach custom headers to cross-site form posts, and a cross-origin fetch with a
    custom header triggers a CORS preflight that this API does not approve.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            s = get_settings()
            if _header(scope, s.csrf_header.lower().encode()) != s.csrf_value:
                await _send_json(
                    send,
                    403,
                    envelope("csrf_failed", f"Missing or invalid {s.csrf_header} header"),
                )
                return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    """413 for request bodies over the limit (5 MB default; 25 MB + multipart overhead for drawing uploads)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in SAFE_METHODS:
            await self.app(scope, receive, send)
            return
        s = get_settings()
        limit = (
            s.max_upload_bytes + MULTIPART_OVERHEAD
            if _UPLOAD_PATH_RE.match(scope["path"])
            else s.max_building_body_bytes
        )
        too_large = envelope("payload_too_large", f"Request body exceeds {limit // (1024 * 1024)} MB limit")
        declared = _header(scope, b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    await _send_json(send, 413, too_large)
                    return
            except ValueError:
                await _send_json(send, 400, envelope("bad_request", "Invalid Content-Length"))
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Raised inside the app's body read; FastAPI re-raises HTTPException untouched and the
                    # app's handler renders the standard envelope.
                    raise HTTPException(413, too_large["error"]["message"])
            return message

        await self.app(scope, limited_receive, send)
