"""Uniform error envelope: {"error": {"code", "message", "details?"}}."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("hvac.errors")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def not_found(entity: str = "Resource") -> ApiError:
    return ApiError(404, "not_found", f"{entity} not found")


def forbidden(message: str = "You do not have permission to perform this action") -> ApiError:
    return ApiError(403, "forbidden", message)


def bad_request(message: str, code: str = "bad_request", details: Any = None) -> ApiError:
    return ApiError(400, code, message, details)


def conflict(message: str, code: str = "conflict", details: Any = None) -> ApiError:
    return ApiError(409, code, message, details)


def unprocessable(message: str, code: str = "validation_error", details: Any = None) -> ApiError:
    return ApiError(422, code, message, details)


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    501: "not_implemented",
}


def envelope(code: str, message: str, details: Any = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


def format_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for e in errors:
        loc = [p for p in e.get("loc", ()) if p not in ("body",)]
        out.append({"loc": loc, "msg": e.get("msg", ""), "type": e.get("type", "")})
    return out


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(envelope(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ").capitalize()
        return JSONResponse(envelope(code, message), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse(
            envelope("validation_error", "Request validation failed", format_validation_errors(exc.errors())),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(envelope("internal_error", "An unexpected error occurred"), status_code=500)
