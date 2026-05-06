from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend import main  # noqa: E402


class _FakeQuery:
    def __init__(
        self,
        rows: list[dict[str, object]],
        table_name: str | None = None,
        tables: dict[str, list[dict[str, object]]] | None = None,
    ) -> None:
        self._rows = rows
        self._table_name = table_name
        self._tables = tables
        self._filters: list[tuple[str, str, object]] = []
        self._limit: int | None = None
        self._insert_payload: list[dict[str, object]] | None = None

    def select(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def eq(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if len(_args) >= 2:
            self._filters.append(("eq", str(_args[0]), _args[1]))
        return self

    def limit(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if _args:
            self._limit = int(_args[0])
        return self

    def insert(self, payload: object) -> "_FakeQuery":
        if isinstance(payload, list):
            self._insert_payload = [dict(item) for item in payload if isinstance(item, dict)]
        elif isinstance(payload, dict):
            self._insert_payload = [dict(payload)]
        else:
            self._insert_payload = []
        return self

    def execute(self) -> SimpleNamespace:
        rows = [dict(row) for row in self._rows]
        for kind, field, expected in self._filters:
            if kind == "eq":
                rows = [row for row in rows if row.get(field) == expected]
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._insert_payload is not None and self._table_name and self._tables is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            inserted_rows: list[dict[str, object]] = []
            for item in self._insert_payload:
                new_row = dict(item)
                new_row.setdefault("id", f"{self._table_name}-{len(table_rows) + len(inserted_rows) + 1}")
                table_rows.append(new_row)
                inserted_rows.append(new_row)
            return SimpleNamespace(data=inserted_rows)
        return SimpleNamespace(data=rows)


class _FakeClient:
    def __init__(self, tables: dict[str, list[dict[str, object]]]) -> None:
        self._tables = tables

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self._tables.get(name, []), name, self._tables)


class _FakeDB:
    def __init__(self, tables: dict[str, list[dict[str, object]]]) -> None:
        self._client = _FakeClient(tables)

    def get_client(self, user_token: str | None = None) -> _FakeClient:
        return self._client

    @staticmethod
    def many(response: SimpleNamespace) -> list[dict[str, object]]:
        data = getattr(response, "data", None) or []
        return data if isinstance(data, list) else []

    @staticmethod
    def first(response: SimpleNamespace) -> dict[str, object] | None:
        data = getattr(response, "data", None) or []
        if isinstance(data, list):
            return data[0] if data else None
        return data if isinstance(data, dict) else None


class InterviewProctoringEventsTest(unittest.TestCase):
    def test_record_proctoring_events_inserts_valid_multiple_faces_high_event(self) -> None:
        fake_db = _FakeDB(
            {
                "interview_sessions": [{"id": "session-1", "interview_id": "interview-1"}],
                "interview_proctoring_events": [],
            }
        )
        payload = main.RecordProctoringEventsPayload(
            interviewId="interview-1",
            sessionId="session-1",
            events=[
                main.ProctoringEventPayload(
                    eventType="multiple_faces",
                    severity="high",
                    confidence=0.93,
                    startedAt="2026-05-06T10:00:00Z",
                    endedAt="2026-05-06T10:00:02Z",
                    durationMs=2100,
                    snapshotPaths=[" /snapshots/a.jpg ", "/snapshots/b.jpg", "/snapshots/c.jpg", "/snapshots/d.jpg"],
                    metadata={"face_count": 2},
                )
            ],
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.record_proctoring_events(payload, "Bearer token")

        self.assertTrue(response["ok"])
        self.assertEqual(response["interview_id"], "interview-1")
        self.assertEqual(response["session_id"], "session-1")
        self.assertEqual(response["inserted_count"], 1)
        self.assertEqual(len(fake_db._client._tables["interview_proctoring_events"]), 1)
        inserted = fake_db._client._tables["interview_proctoring_events"][0]
        self.assertEqual(inserted["interview_id"], "interview-1")
        self.assertEqual(inserted["session_id"], "session-1")
        self.assertEqual(inserted["event_type"], "multiple_faces")
        self.assertEqual(inserted["severity"], "high")
        self.assertEqual(inserted["created_by"], "user-1")
        self.assertEqual(inserted["snapshot_paths"], ["/snapshots/a.jpg", "/snapshots/b.jpg", "/snapshots/c.jpg"])
        self.assertEqual(inserted["metadata"], {"face_count": 2})

    def test_record_proctoring_events_rejects_session_interview_mismatch(self) -> None:
        fake_db = _FakeDB(
            {
                "interview_sessions": [{"id": "session-1", "interview_id": "interview-2"}],
                "interview_proctoring_events": [],
            }
        )
        payload = main.RecordProctoringEventsPayload(
            interviewId="interview-1",
            sessionId="session-1",
            events=[
                main.ProctoringEventPayload(
                    eventType="multiple_faces",
                    severity="high",
                    startedAt="2026-05-06T10:00:00Z",
                )
            ],
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            with self.assertRaises(HTTPException) as raised:
                main.record_proctoring_events(payload, "Bearer token")

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(len(fake_db._client._tables["interview_proctoring_events"]), 0)


if __name__ == "__main__":
    unittest.main()
