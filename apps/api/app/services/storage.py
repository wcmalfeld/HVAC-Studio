"""Blob storage abstraction. LocalDiskStorage for dev/single-node; add S3Storage behind the same interface."""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_.-]{0,499}$")


class StorageBackend(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def open_stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...


class LocalDiskStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        if not _KEY_RE.match(key) or ".." in key.split("/"):
            raise ValueError("invalid storage key")
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise ValueError("invalid storage key")
        return p

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: never leave a half-written blob under the final key.
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def open_stream(self, key: str, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        path = self._path(key)
        with path.open("rb") as f:
            while chunk := f.read(chunk_size):
                yield chunk

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        _storage = LocalDiskStorage(get_settings().storage_dir)
    return _storage


def set_storage(backend: StorageBackend) -> None:
    global _storage
    _storage = backend
