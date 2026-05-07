"""Helpers for reporting runtime configuration."""

import os
from typing import Any, Dict

from src.agent.interview_config import get_interview_question_config


def _get_declared_worker_count() -> int:
    for key in ("AGENT_WORKER_COUNT", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        raw = os.getenv(key, "").strip()
        if not raw:
            continue
        try:
            return max(1, int(raw))
        except ValueError:
            return 1
    return 1


def get_runtime_settings_snapshot() -> Dict[str, Any]:
    question_config = get_interview_question_config()
    backend = os.getenv("AGENT_CHECKPOINT_BACKEND", "memory").strip().lower() or "memory"
    sqlite_path = os.getenv("AGENT_CHECKPOINT_SQLITE_PATH", "").strip() or "artifacts/checkpoints/interview.sqlite"
    worker_count = _get_declared_worker_count()

    return {
        "interview_question_range": f"{question_config.min_questions}-{question_config.max_questions}",
        "checkpoint_backend": backend,
        "checkpoint_location": sqlite_path if backend == "sqlite" else "",
        "declared_worker_count": worker_count,
        "session_lock_scope": "single-process",
    }


def validate_runtime_deployment_settings() -> None:
    """Fail fast for deployment modes that exceed the current lock/checkpoint guarantees."""
    backend = os.getenv("AGENT_CHECKPOINT_BACKEND", "memory").strip().lower() or "memory"
    worker_count = _get_declared_worker_count()
    allow_unsafe = os.getenv("AGENT_ALLOW_UNSAFE_SQLITE_MULTIPROCESS", "").strip().lower()

    if backend == "sqlite" and worker_count > 1 and allow_unsafe not in {"1", "true", "yes"}:
        raise RuntimeError(
            "sqlite checkpoint backend is single-process only with the current SessionLockManager. "
            "Use WEB_CONCURRENCY=1/UVICORN_WORKERS=1, switch to memory for ephemeral local runs, "
            "or add a cross-process lock/checkpoint backend before using multiple workers."
        )
