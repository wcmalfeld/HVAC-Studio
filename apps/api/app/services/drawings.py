"""Drawing upload validation (magic bytes, size) for the import foundation (PRD §7)."""

from __future__ import annotations

import os
import re
import unicodedata

from app.core.errors import ApiError

# content-type → (magic-byte predicate, canonical extension)
ALLOWED: dict[str, tuple[str, str]] = {
    "application/pdf": ("pdf", ".pdf"),
    "image/png": ("png", ".png"),
    "image/jpeg": ("jpeg", ".jpg"),
}

PLANNED_EXTS = {".dxf", ".dwg"}
PLANNED_TYPES = {
    "image/vnd.dxf",
    "application/dxf",
    "image/x-dxf",
    "image/vnd.dwg",
    "application/acad",
    "application/x-dwg",
    "image/x-dwg",
}


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"AC10"):  # DWG version header (AC1012…AC1032)
        return "image/vnd.dwg"
    return None


def sanitize_filename(name: str | None, fallback_ext: str) -> str:
    name = os.path.basename((name or "").replace("\\", "/"))
    name = unicodedata.normalize("NFKC", name)
    name = re.sub(r"[^\w.\- ()]+", "_", name).strip(" .")
    if not name:
        name = f"drawing{fallback_ext}"
    return name[:200]


def validate_upload(filename: str | None, declared_type: str | None, data: bytes, max_bytes: int) -> str:
    """Return the verified content type, or raise ApiError (413/415/422)."""
    ext = os.path.splitext(filename or "")[1].lower()
    declared = (declared_type or "").split(";")[0].strip().lower()
    if ext in PLANNED_EXTS or declared in PLANNED_TYPES or sniff(data[:8]) == "image/vnd.dwg":
        raise ApiError(
            415,
            "unsupported_media_type",
            "DXF/DWG import is planned but not yet supported. Export the plan to PDF, PNG or JPEG and upload that.",
            {"planned": ["dxf", "dwg"], "accepted": sorted(ALLOWED)},
        )
    if len(data) > max_bytes:
        raise ApiError(413, "payload_too_large", f"File exceeds {max_bytes // (1024 * 1024)} MB limit")
    if not data:
        raise ApiError(422, "empty_file", "Uploaded file is empty")
    if declared and declared != "application/octet-stream" and declared not in ALLOWED:
        raise ApiError(
            415,
            "unsupported_media_type",
            f"Unsupported content type '{declared}'. Accepted: PDF, PNG, JPEG.",
            {"accepted": sorted(ALLOWED)},
        )
    actual = sniff(data[:16])
    if actual not in ALLOWED:
        raise ApiError(
            415,
            "unsupported_media_type",
            "File content is not a valid PDF, PNG or JPEG",
            {"accepted": sorted(ALLOWED)},
        )
    if declared and declared != "application/octet-stream" and declared != actual:
        raise ApiError(
            415,
            "content_type_mismatch",
            f"Declared content type '{declared}' does not match file content ('{actual}')",
        )
    return actual
