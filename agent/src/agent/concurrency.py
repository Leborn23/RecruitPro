"""Per-session concurrency primitives."""

from contextlib import contextmanager
import threading
from typing import Iterator


class SessionLockManager:
    """Serialize operations for the same session/thread id within one process."""

    def __init__(self) -> None:
        self._locks: dict[str, threading.RLock] = {}
        self._guard = threading.Lock()

    def _get_lock(self, session_id: str) -> threading.RLock:
        with self._guard:
            lock = self._locks.get(session_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[session_id] = lock
            return lock

    @contextmanager
    def locked(self, session_id: str) -> Iterator[None]:
        lock = self._get_lock(session_id)
        lock.acquire()
        try:
            yield
        finally:
            lock.release()
