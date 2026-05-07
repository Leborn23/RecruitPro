"""Factory for selecting checkpoint backends from configuration."""

import os
import sqlite3
from pathlib import Path

from src.agent.checkpoint_compat import get_msgpack_allowed_types


def _build_jsonplus_serde():
    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

    return JsonPlusSerializer(allowed_msgpack_modules=tuple(get_msgpack_allowed_types()))


def create_checkpointer():
    backend = os.getenv("AGENT_CHECKPOINT_BACKEND", "memory").strip().lower()

    if backend == "memory":
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver(serde=_build_jsonplus_serde())

    if backend == "sqlite":
        sqlite_path = os.getenv("AGENT_CHECKPOINT_SQLITE_PATH", "").strip() or "artifacts/checkpoints/interview.sqlite"
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver  # type: ignore
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "sqlite checkpoint backend requested but langgraph sqlite support is not installed"
            ) from exc
        path_obj = Path(sqlite_path)
        if path_obj.parent and str(path_obj.parent) not in {"", "."}:
            path_obj.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path_obj, check_same_thread=False)
        saver = SqliteSaver(conn, serde=_build_jsonplus_serde())
        saver.setup()
        setattr(saver, "_owned_sqlite_conn", conn)
        return saver

    raise RuntimeError(f"Unsupported checkpoint backend: {backend}")
