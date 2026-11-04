# HVAC Studio API — build context: repo root (so the sample-house fixture can be baked in).
#   docker build -f infrastructure/docker/api.Dockerfile .
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SAMPLE_HOUSE_PATH=/app/fixtures/sample-house.json STORAGE_DIR=/app/storage PORT=8000
WORKDIR /app

RUN useradd --create-home --uid 10001 hvac

# Dependency layer (cached until pyproject.toml changes).
COPY apps/api/pyproject.toml ./
RUN python - <<'PY' > /tmp/requirements.txt
import tomllib
print("\n".join(tomllib.load(open("pyproject.toml", "rb"))["project"]["dependencies"]))
PY
RUN pip install -r /tmp/requirements.txt

COPY apps/api/alembic.ini ./
COPY apps/api/alembic ./alembic
COPY apps/api/app ./app
COPY apps/api/scripts ./scripts
COPY packages/shared-types/fixtures/sample-house.json ./fixtures/sample-house.json
RUN mkdir -p /app/storage && chown -R hvac:hvac /app/storage

USER hvac
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/v1/health').status==200 else 1)"
# Apply migrations, then serve. Hosts like Render inject $PORT; default 8000.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
