"""
Application entry point / factory.

Run locally:
    cd backend
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, conversations, personas, speech
from app.bootstrap import run_bootstrap
from app.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hindimitra")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema is managed by Alembic migrations, not create_all. Bootstrap only
    # seeds data (personas + admin) that migrations don't own.
    logger.info("Starting Hindi Mitra (env=%s, postgres=%s)", settings.environment, settings.uses_postgres)
    await run_bootstrap()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Hindi Mitra",
        version="1.0.0",
        description="Hindi speaking-assessment platform",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,   # required so the session cookie is sent
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = (time.monotonic() - start) * 1000
        logger.info(
            "%s %s -> %d (%.0fms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    app.include_router(auth.router)
    app.include_router(personas.router)
    app.include_router(conversations.router)
    app.include_router(admin.router)
    app.include_router(speech.router)

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok", "environment": settings.environment}

    return app


app = create_app()
