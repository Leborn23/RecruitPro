"""Utilities for optional LangSmith tracing integration."""
from __future__ import annotations

import os
from contextlib import contextmanager, nullcontext
from typing import Any, Callable, Dict, Iterable, Optional

try:
    from langsmith import traceable as _traceable
    from langsmith.run_helpers import tracing_context

    HAS_LANGSMITH = True
except Exception:
    HAS_LANGSMITH = False

    def _traceable(*_args: Any, **_kwargs: Any):
        def _decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return func

        return _decorator

    def tracing_context(**_kwargs: Any):
        return nullcontext()


def traceable(*args: Any, **kwargs: Any):
    """统一导出 traceable，便于在无 langsmith 依赖时自动降级为 no-op。"""
    return _traceable(*args, **kwargs)


def _to_bool(raw: Optional[str], default: bool = False) -> bool:
    """把环境变量字符串转成布尔值，兼容 1/true/yes/on。"""
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_langsmith_tracing_enabled() -> bool:
    """仅由环境变量 LANGSMITH_TRACING 控制是否开启 tracing。"""
    return _to_bool(os.getenv("LANGSMITH_TRACING"), default=False)


def build_langsmith_extra(
    *,
    thread_id: Optional[str] = None,
    session_id: Optional[str] = None,
    run_name: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """构建传给 @traceable 的 langsmith_extra，统一 run 名称、标签、元数据。"""
    extra: Dict[str, Any] = {}
    merged_metadata: Dict[str, Any] = dict(metadata or {})
    if thread_id:
        merged_metadata["thread_id"] = thread_id
    if session_id:
        merged_metadata["session_id"] = session_id

    if run_name:
        extra["name"] = run_name
    if merged_metadata:
        extra["metadata"] = merged_metadata
    if tags:
        extra["tags"] = list(tags)
    return extra


def call_with_langsmith_extra(
    func: Callable[..., Any], *args: Any, langsmith_extra: Optional[Dict[str, Any]] = None, **kwargs: Any
) -> Any:
    """兼容调用：
    - 有 LangSmith 且传了 extra：注入 langsmith_extra
    - 否则：原样调用，避免在无依赖环境报错
    """
    if HAS_LANGSMITH and langsmith_extra:
        return func(*args, langsmith_extra=langsmith_extra, **kwargs)
    return func(*args, **kwargs)


@contextmanager
def interview_tracing_context(
    *, thread_id: Optional[str] = None, session_id: Optional[str] = None, tags: Optional[Iterable[str]] = None
):
    """会话级 tracing context。

    作用：把 thread_id / session_id 放到同一个 tracing 上下文里，
    让整条面试链路在 LangSmith 中可按会话聚合查看。
    """
    if not (HAS_LANGSMITH and is_langsmith_tracing_enabled()):
        yield
        return

    metadata: Dict[str, Any] = {}
    if thread_id:
        metadata["thread_id"] = thread_id
    if session_id:
        metadata["session_id"] = session_id

    try:
        with tracing_context(metadata=metadata, tags=list(tags or [])):
            yield
    except TypeError:
        # Compatibility fallback for older langsmith signatures.
        with tracing_context():
            yield
