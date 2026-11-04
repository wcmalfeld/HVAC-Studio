from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.v1 import auth, building, drawings, projects
from app.core.db import get_db

api_router = APIRouter(prefix="/api/v1")


@api_router.get("/health", tags=["health"])
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "unavailable", "version": "0.1.0"}


api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(building.router)
api_router.include_router(drawings.router)
