from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
import httpx

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend import main  # noqa: E402


class AgentFetchTest(unittest.TestCase):
    def test_agent_fetch_converts_connection_error_to_502(self) -> None:
        request = httpx.Request("POST", "http://127.0.0.1:8000/agent/start")
        with patch.dict(main.os.environ, {"AGENT_BASE_URL": "http://127.0.0.1:8000"}), patch(
            "httpx.Client.request",
            side_effect=httpx.ConnectError("connection refused", request=request),
        ):
            with self.assertRaises(HTTPException) as raised:
                main.agent_fetch("/agent/start", {"session_id": "session-1"})

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("Agent service unavailable", str(raised.exception.detail))


class _FakeQuery:
    def __init__(self, rows: list[dict[str, object]], table_name: str, tables: dict[str, list[dict[str, object]]]) -> None:
        self._rows = rows
        self._table_name = table_name
        self._tables = tables
        self._filters: list[tuple[str, object]] = []
        self._limit: int | None = None
        self._update_payload: dict[str, object] | None = None
        self._upsert_payload: dict[str, object] | None = None
        self._insert_payload: dict[str, object] | None = None

    def select(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def eq(self, field: str, value: object) -> "_FakeQuery":
        self._filters.append((field, value))
        return self

    def limit(self, value: int) -> "_FakeQuery":
        self._limit = value
        return self

    def order(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def update(self, payload: dict[str, object]) -> "_FakeQuery":
        self._update_payload = payload
        return self

    def insert(self, payload: dict[str, object]) -> "_FakeQuery":
        self._insert_payload = payload
        return self

    def upsert(self, payload: dict[str, object], **_kwargs: object) -> "_FakeQuery":
        self._upsert_payload = dict(payload)
        return self

    def execute(self) -> SimpleNamespace:
        rows = [dict(row) for row in self._rows]
        for field, expected in self._filters:
            rows = [row for row in rows if row.get(field) == expected]
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._update_payload is not None:
            updated_rows: list[dict[str, object]] = []
            table_rows = self._tables.setdefault(self._table_name, [])
            for index, row in enumerate(table_rows):
                if all(row.get(field) == value for field, value in self._filters):
                    merged = {**row, **self._update_payload}
                    table_rows[index] = merged
                    updated_rows.append(merged)
            return SimpleNamespace(data=updated_rows)
        if self._upsert_payload is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            conflict_field = "session_id" if self._table_name == "interview_reports" else "id"
            matched_index = None
            for index, row in enumerate(table_rows):
                if row.get(conflict_field) == self._upsert_payload.get(conflict_field):
                    matched_index = index
                    break
            if matched_index is None:
                new_row = dict(self._upsert_payload)
                new_row.setdefault("id", f"{self._table_name}-{len(table_rows) + 1}")
                table_rows.append(new_row)
                return SimpleNamespace(data=[new_row])
            merged = {**table_rows[matched_index], **self._upsert_payload}
            table_rows[matched_index] = merged
            return SimpleNamespace(data=[merged])
        if self._insert_payload is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            payloads = self._insert_payload if isinstance(self._insert_payload, list) else [self._insert_payload]
            inserted_rows: list[dict[str, object]] = []
            for payload in payloads:
                new_row = dict(payload)
                new_row.setdefault("id", f"{self._table_name}-{len(table_rows) + 1}")
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
        self.last_user_token: str | None = None

    def get_client(self, user_token: str | None = None) -> _FakeClient:
        self.last_user_token = user_token
        return self._client

    @staticmethod
    def first(response: SimpleNamespace) -> dict[str, object] | None:
        data = getattr(response, "data", None) or []
        return data[0] if isinstance(data, list) and data else None

    @staticmethod
    def many(response: SimpleNamespace) -> list[dict[str, object]]:
        data = getattr(response, "data", None) or []
        return data if isinstance(data, list) else []


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
        self.assertIsNone(fake_db.last_user_token)

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

    def test_record_proctoring_events_accepts_schema_only_camera_denied_event(self) -> None:
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
                    eventType="camera_denied",
                    severity="high",
                    startedAt="2026-05-06T10:00:00Z",
                )
            ],
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.record_proctoring_events(payload, "Bearer token")

        self.assertTrue(response["ok"])
        self.assertEqual(response["inserted_count"], 1)
        inserted = fake_db._client._tables["interview_proctoring_events"][0]
        self.assertEqual(inserted["event_type"], "camera_denied")

    def test_record_proctoring_events_accepts_head_pose_event_metadata(self) -> None:
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
                    eventType="head_turned_right",
                    severity="medium",
                    confidence=0.88,
                    startedAt="2026-05-06T10:00:00Z",
                    endedAt="2026-05-06T10:00:04Z",
                    durationMs=4000,
                    metadata={
                        "pose_signal": "head_turned_right",
                        "head_pose": {"yaw": 34, "pitch": -4, "roll": 2},
                        "landmark_count": 478,
                    },
                )
            ],
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.record_proctoring_events(payload, "Bearer token")

        self.assertTrue(response["ok"])
        inserted = fake_db._client._tables["interview_proctoring_events"][0]
        self.assertEqual(inserted["event_type"], "head_turned_right")
        self.assertEqual(inserted["metadata"]["head_pose"]["yaw"], 34)

    def test_record_proctoring_events_rejects_implementation_only_face_missing_event(self) -> None:
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
                    eventType="face_missing",
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

    def test_score_interview_merges_proctoring_risk_into_report(self) -> None:
        fake_db = _FakeDB(
            {
                "interview_sessions": [
                    {
                        "id": "session-1",
                        "interview_id": "interview-1",
                        "candidate_id": "candidate-1",
                        "status": "scoring",
                    }
                ],
                "interview_reports": [],
                "interview_proctoring_events": [
                    {
                        "id": "event-2",
                        "session_id": "session-1",
                        "interview_id": "interview-1",
                        "event_type": "multiple_faces",
                        "severity": "high",
                        "snapshot_paths": ["/snapshots/b.jpg"],
                        "created_at": "2026-05-06T10:00:02Z",
                    },
                    {
                        "id": "event-1",
                        "session_id": "session-1",
                        "interview_id": "interview-1",
                        "event_type": "multiple_faces",
                        "severity": "high",
                        "snapshot_paths": ["/snapshots/a.jpg"],
                        "created_at": "2026-05-06T10:00:01Z",
                    },
                    {
                        "id": "event-3",
                        "session_id": "session-1",
                        "interview_id": "interview-1",
                        "event_type": "page_hidden",
                        "severity": "medium",
                        "snapshot_paths": ["/snapshots/c.jpg"],
                        "created_at": "2026-05-06T10:00:03Z",
                    },
                ],
                "upcoming_interviews": [{"id": "interview-1", "status": "completed"}],
            }
        )
        final_report = {
            "overall_score": 80,
            "hire_recommendation": "lean hire",
            "strengths": [{"claim": "Structured answers"}],
            "weaknesses": [{"claim": "Needs deeper tradeoff analysis"}],
            "detailed_evaluations": [
                {
                    "question": "Question 1",
                    "answer": "Answer 1",
                    "feedback": "Good structure",
                    "missing_logic_elements": [],
                    "dimensions": {
                        "technical_depth": 8,
                        "communication_logic": 8,
                        "problem_solving": 8,
                    },
                }
            ],
        }
        payload = main.ScoreInterviewPayload(interviewId="interview-1", sessionId="session-1")

        with (
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "db", fake_db),
            patch.object(
                main,
                "agent_fetch",
                return_value={"response": {"status": "finish", "final_report": final_report}},
            ),
        ):
            response = main.score_interview(payload, "Bearer token")

        report = response["report"]
        self.assertEqual(report["recommendation"], "needs_review")
        self.assertGreaterEqual(report["risk_score"], 45)
        proctoring_risks = [
            item
            for item in report["risks"]
            if isinstance(item, dict) and item.get("type") == "proctoring"
        ]
        self.assertTrue(proctoring_risks)
        self.assertIn("多人", proctoring_risks[0]["message"])
        self.assertIn("监考", proctoring_risks[0]["message"])
        proctoring_evidence = [
            item
            for item in report["evidence"]
            if isinstance(item, dict) and item.get("type") == "proctoring"
        ][0]
        self.assertIsInstance(proctoring_evidence.get("summary"), str)
        self.assertIn("多人", proctoring_evidence["summary"])


class InterviewHumanConfirmTest(unittest.TestCase):
    def test_agent_fetch_bypasses_environment_proxy_for_local_agent(self) -> None:
        captured: dict[str, object] = {}

        class _FakeHttpClient:
            def __init__(self, **kwargs: object) -> None:
                captured.update(kwargs)

            def __enter__(self) -> "_FakeHttpClient":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def request(self, *_args: object, **_kwargs: object) -> SimpleNamespace:
                return SimpleNamespace(status_code=200, json=lambda: {"ok": True})

        with (
            patch.object(main, "env", return_value="http://127.0.0.1:8000"),
            patch.object(main.httpx, "Client", _FakeHttpClient),
        ):
            result = main.agent_fetch("/healthz", method="GET")

        self.assertEqual(result, {"ok": True})
        self.assertIs(captured.get("trust_env"), False)

    def test_start_reuses_existing_agent_session_instead_of_storing_duplicate_session_error(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "ready",
                    "question_plan": [],
                    "started_at": None,
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "started_at": None}],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [{"id": "position-1", "title": "Engineer", "department": "R&D"}],
            "parsed_resume_profiles": [],
            "parsed_resume_projects": [],
            "parsed_job_requirements": [],
            "interview_turns": [],
        }
        duplicate_response = {
            "status": "error",
            "message": "Session already exists. Use the existing session id or create a new one.",
        }
        status_response = {
            "response": {
                "status": "ask",
                "message": "请介绍你最相关的一段项目经历。",
                "interview_plan": {
                    "questions": [
                        {
                            "id": "q1",
                            "topic": "项目经历",
                            "prompt": "请介绍你最相关的一段项目经历。",
                            "answer_guidance": "说明背景、职责和结果。",
                        }
                    ]
                },
            }
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", side_effect=[duplicate_response, status_response]) as agent_fetch,
        ):
            result = main.start_interview(
                main.StartInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        self.assertEqual(agent_fetch.call_args_list[1].args, ("/agent/status?session_id=session-1",))
        self.assertEqual(agent_fetch.call_args_list[1].kwargs, {"method": "GET"})
        self.assertEqual(result["first_question"], "请介绍你最相关的一段项目经历。")
        self.assertEqual(tables["interview_turns"][0]["content"], "请介绍你最相关的一段项目经历。")
        self.assertEqual(tables["interview_turns"][0]["created_by"], "user-1")
        self.assertNotIn("Session already exists", tables["interview_turns"][0]["content"])

    def test_start_recovers_when_agent_start_500_already_created_runtime_session(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "ready",
                    "question_plan": [{"id": "prepared-q1", "prompt": "Prepared Q1"}],
                    "started_at": None,
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "ready", "started_at": None}],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [{"id": "position-1", "title": "Engineer", "department": "R&D"}],
            "parsed_resume_profiles": [],
            "parsed_resume_projects": [],
            "parsed_job_requirements": [],
            "interview_turns": [],
        }
        recovered_status = {
            "response": {
                "status": "ask",
                "message": "Q1",
                "interview_plan": {
                    "questions": [
                        {"id": "q1", "prompt": "Q1", "answer_guidance": "G1"},
                    ]
                },
            },
            "state_snapshot": {"asked_question_count": 1, "answer_count": 0},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(
                main,
                "agent_fetch",
                side_effect=[
                    main.HTTPException(status_code=500, detail="Internal Server Error"),
                    recovered_status,
                ],
            ) as agent_fetch,
        ):
            result = main.start_interview(
                main.StartInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        self.assertEqual(agent_fetch.call_args_list[0].args[0], "/agent/start")
        self.assertEqual(agent_fetch.call_args_list[1].args, ("/agent/status?session_id=session-1",))
        self.assertEqual(agent_fetch.call_args_list[1].kwargs, {"method": "GET"})
        self.assertTrue(result["ok"])
        self.assertEqual(tables["interview_sessions"][0]["status"], "running")
        self.assertEqual(tables["upcoming_interviews"][0]["status"], "in_progress")
        self.assertEqual(tables["interview_turns"][0]["content"], "Q1")

    def test_append_turn_records_candidate_and_ai_reply_with_user_id_after_agent_accepts_answer(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "running",
                    "started_at": "2026-04-29T12:00:00+00:00",
                    "question_plan": [
                        {"prompt": "Q1", "answer_guidance": "G1"},
                        {"prompt": "Q2", "answer_guidance": "G2"},
                    ],
                }
            ],
            "interview_turns": [
                {
                    "id": "turn-1",
                    "session_id": "session-1",
                    "turn_no": 1,
                    "speaker": "ai",
                    "content": "Q1",
                    "metadata": {"kind": "question"},
                    "created_by": "user-1",
                }
            ],
        }
        agent_response = {
            "status": "ask",
            "message": "Q2",
            "state_snapshot": {
                "asked_question_count": 2,
                "answer_count": 1,
                "next_nodes": ["evaluate_answer"],
            },
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "agent_fetch", return_value=agent_response) as agent_fetch,
        ):
            result = main.append_turn(
                main.AppendTurnPayload(sessionId="session-1", speaker="candidate", content="A1"),
                authorization="Bearer token",
            )

        agent_fetch.assert_called_once_with(
            "/agent/answer",
            {
                "session_id": "session-1",
                "user_answer": "A1",
            },
        )
        self.assertTrue(result["ok"])
        self.assertEqual(tables["interview_turns"][1]["speaker"], "candidate")
        self.assertEqual(tables["interview_turns"][1]["created_by"], "user-1")
        self.assertEqual(tables["interview_turns"][2]["speaker"], "ai")
        self.assertEqual(tables["interview_turns"][2]["content"], "Q2")
        self.assertEqual(tables["interview_turns"][2]["created_by"], "user-1")

    def test_append_turn_rejects_agent_business_error_without_persisting_error_as_ai_reply(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "running",
                    "started_at": "2026-04-29T12:00:00+00:00",
                    "question_plan": [],
                }
            ],
            "interview_turns": [
                {
                    "id": "turn-1",
                    "session_id": "session-1",
                    "turn_no": 1,
                    "speaker": "ai",
                    "content": "Q1",
                    "metadata": {"kind": "question"},
                    "created_by": "user-1",
                }
            ],
        }
        agent_response = {
            "status": "error",
            "message": "Session is not waiting for a candidate answer.",
            "metadata": {"error": "Session is not waiting for a candidate answer."},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "agent_fetch", return_value=agent_response),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.append_turn(
                    main.AppendTurnPayload(sessionId="session-1", speaker="candidate", content="A1"),
                    authorization="Bearer token",
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(len(tables["interview_turns"]), 1)

    def test_append_turn_rejects_agent_system_message_even_when_status_is_ask(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "running",
                    "started_at": "2026-04-29T12:00:00+00:00",
                    "question_plan": [{"prompt": "Q1"}],
                }
            ],
            "interview_turns": [
                {
                    "id": "turn-1",
                    "session_id": "session-1",
                    "turn_no": 1,
                    "speaker": "ai",
                    "content": "Q1",
                    "metadata": {"kind": "question"},
                    "created_by": "user-1",
                }
            ],
        }
        agent_response = {
            "status": "ask",
            "message": "Session is not waiting for a candidate answer.",
            "state_snapshot": {"asked_question_count": 0, "answer_count": 0, "next_nodes": ["build_gap_analysis"]},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "agent_fetch", return_value=agent_response),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.append_turn(
                    main.AppendTurnPayload(sessionId="session-1", speaker="candidate", content="A1"),
                    authorization="Bearer token",
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(len(tables["interview_turns"]), 1)

    def test_prepare_does_not_reset_running_session_or_replace_agent_plan(self) -> None:
        agent_plan = [{"id": "agent-q1", "prompt": "Agent Q1"}]
        tables: dict[str, list[dict[str, object]]] = {
            "upcoming_interviews": [
                {
                    "id": "interview-1",
                    "status": "in_progress",
                    "candidate_id": "candidate-1",
                    "session_id": "session-1",
                }
            ],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [
                {
                    "id": "position-1",
                    "title": "Engineer",
                    "department": "R&D",
                    "technical_requirements": "Python",
                    "min_exp": 2,
                    "min_edu": "Bachelor",
                }
            ],
            "parsed_resume_profiles": [],
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "mode": "async_qa",
                    "status": "running",
                    "question_plan": agent_plan,
                    "context_payload": {},
                }
            ],
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
        ):
            result = main.prepare_interview(
                main.PrepareInterviewPayload(
                    interviewId="interview-1",
                    candidateId="candidate-1",
                    positionId="position-1",
                ),
                authorization="Bearer token",
            )

        self.assertEqual(result["session_id"], "session-1")
        self.assertEqual(result["question_plan"], agent_plan)
        self.assertEqual(tables["interview_sessions"][0]["status"], "running")
        self.assertEqual(tables["interview_sessions"][0]["question_plan"], agent_plan)
        self.assertEqual(tables["upcoming_interviews"][0]["status"], "in_progress")

    def test_prepare_uses_company_interview_question_count_over_payload(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "company_settings": [{"id": "settings-1", "interview_question_count": 3}],
            "upcoming_interviews": [{"id": "interview-1", "status": "ready", "candidate_id": "candidate-1"}],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [
                {
                    "id": "position-1",
                    "title": "Engineer",
                    "department": "R&D",
                    "technical_requirements": "Python",
                    "min_exp": 2,
                    "min_edu": "Bachelor",
                }
            ],
            "parsed_resume_profiles": [],
            "interview_sessions": [],
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
        ):
            result = main.prepare_interview(
                main.PrepareInterviewPayload(
                    interviewId="interview-1",
                    candidateId="candidate-1",
                    positionId="position-1",
                    questionCount=8,
                ),
                authorization="Bearer token",
            )

        self.assertEqual(result["question_count"], 3)
        self.assertEqual(len(tables["interview_sessions"][0]["question_plan"]), 3)

    def test_start_passes_session_question_count_to_agent(self) -> None:
        plan = [{"id": "q1"}, {"id": "q2"}, {"id": "q3"}]
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "ready",
                    "question_plan": plan,
                    "started_at": None,
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "started_at": None}],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [{"id": "position-1", "title": "Engineer", "department": "R&D"}],
            "parsed_resume_profiles": [],
            "parsed_resume_projects": [],
            "parsed_job_requirements": [],
            "interview_turns": [],
        }
        agent_response = {
            "status": "ask",
            "message": "Q1",
            "interview_plan": {
                "questions": [
                    {"id": "q1", "prompt": "Q1"},
                    {"id": "q2", "prompt": "Q2"},
                    {"id": "q3", "prompt": "Q3"},
                ]
            },
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", return_value=agent_response) as agent_fetch,
        ):
            result = main.start_interview(
                main.StartInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        self.assertEqual(agent_fetch.call_args.args[0], "/agent/start")
        self.assertEqual(agent_fetch.call_args.args[1]["question_count"], 3)
        self.assertEqual(result["question_count"], 3)

    def test_start_rejects_agent_response_without_question_plan_and_does_not_mark_running(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "position_id": "position-1",
                    "status": "ready",
                    "question_plan": [],
                    "started_at": None,
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "ready", "started_at": None}],
            "candidates": [{"id": "candidate-1", "name": "Candidate", "title": "Engineer"}],
            "active_positions": [{"id": "position-1", "title": "Engineer", "department": "R&D"}],
            "parsed_resume_profiles": [],
            "parsed_resume_projects": [],
            "parsed_job_requirements": [],
            "interview_turns": [],
            "company_settings": [{"id": "settings-1", "interview_question_count": 3}],
        }
        agent_response = {
            "status": "ask",
            "message": "Session already exists. Use the existing session id or create a new one.",
            "interview_plan": {"questions": []},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "agent_fetch", return_value=agent_response),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.start_interview(
                    main.StartInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                    authorization="Bearer token",
                )

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(tables["interview_sessions"][0]["status"], "ready")
        self.assertEqual(tables["upcoming_interviews"][0]["status"], "ready")
        self.assertEqual(tables["interview_turns"], [])

    def test_finish_rejects_when_agent_is_waiting_for_candidate_answer(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "running",
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "in_progress"}],
            "interview_turns": [
                {"id": "turn-1", "session_id": "session-1", "speaker": "ai"},
            ],
        }
        agent_status = {
            "response": {"status": "ask", "message": "Q1"},
            "state_snapshot": {"next_nodes": ["evaluate_answer"]},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "agent_fetch", return_value=agent_status),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.finish_interview(
                    main.FinishInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                    authorization="Bearer token",
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(tables["interview_sessions"][0]["status"], "running")
        self.assertEqual(tables["upcoming_interviews"][0]["status"], "in_progress")

    def test_finish_retries_persisted_latest_answer_when_agent_is_stuck_evaluating(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "running",
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "in_progress"}],
            "interview_turns": [
                {"id": "turn-1", "session_id": "session-1", "turn_no": 1, "speaker": "ai", "content": "Q1"},
                {"id": "turn-2", "session_id": "session-1", "turn_no": 2, "speaker": "candidate", "content": "A1"},
            ],
        }
        stuck_status = {
            "response": {"status": "ask", "message": "Q1"},
            "state_snapshot": {"next_nodes": ["evaluate_answer"]},
        }
        recovered_response = {
            "status": "wait_for_review",
            "message": "Ready for review.",
            "state_snapshot": {"next_nodes": ["request_human_review"]},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", side_effect=[stuck_status, recovered_response]) as agent_fetch,
        ):
            result = main.finish_interview(
                main.FinishInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        self.assertEqual(
            agent_fetch.call_args_list[1].args,
            (
                "/agent/answer",
                {
                    "session_id": "session-1",
                    "user_answer": "A1",
                },
            ),
        )
        self.assertTrue(result["ok"])
        self.assertEqual(tables["interview_sessions"][0]["status"], "scoring")
        self.assertEqual(tables["upcoming_interviews"][0]["status"], "completed")

    def test_score_auto_finalizes_agent_review_before_writing_report(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "scoring",
                }
            ],
            "interview_reports": [],
            "upcoming_interviews": [{"id": "interview-1", "status": "completed"}],
        }
        wait_response = {
            "response": {"status": "wait_for_review", "final_report": None},
            "state_snapshot": {"asked_question_count": 3},
        }
        review_response = {
            "status": "finish",
            "final_report": {
                "overall_score": 76,
                "hire_recommendation": "lean hire",
                "strengths": [{"claim": "Clear problem-solving structure"}],
                "weaknesses": [],
                "detailed_evaluations": [
                    {
                        "question": "Q1",
                        "answer": "A1",
                        "feedback": "Solid",
                        "dimensions": {
                            "technical_depth": 7,
                            "communication_logic": 8,
                            "problem_solving": 7,
                        },
                    }
                ],
            },
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", side_effect=[wait_response, review_response]) as agent_fetch,
        ):
            result = main.score_interview(
                main.ScoreInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        self.assertEqual(agent_fetch.call_args_list[0].args, ("/agent/status?session_id=session-1",))
        self.assertEqual(agent_fetch.call_args_list[0].kwargs, {"method": "GET"})
        self.assertEqual(
            agent_fetch.call_args_list[1].args,
            (
                "/agent/review",
                {
                    "session_id": "session-1",
                    "approved": True,
                    "comments": "Auto-approved by RecruitPro scoring flow.",
                },
            ),
        )
        report = result["report"]
        self.assertEqual(report["overall_score"], 76)
        self.assertEqual(report["recommendation"], "hold")
        self.assertEqual(report["dimension_scores"]["communication"], 80)

    def test_score_rejects_missing_final_report_instead_of_writing_pending_confirmation(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "scoring",
                }
            ],
            "interview_reports": [],
            "upcoming_interviews": [{"id": "interview-1", "status": "completed"}],
        }
        agent_response = {"response": {"status": "ask", "final_report": None}, "state_snapshot": {}}

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", return_value=agent_response) as agent_fetch,
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.score_interview(
                    main.ScoreInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                    authorization="Bearer token",
                )

        agent_fetch.assert_called_once_with(
            "/agent/status?session_id=session-1",
            method="GET",
        )
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(tables["interview_reports"], [])

    def test_score_recovers_from_lost_agent_session_using_persisted_turns(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "scoring",
                }
            ],
            "interview_turns": [
                {
                    "id": "turn-1",
                    "session_id": "session-1",
                    "turn_no": 1,
                    "speaker": "ai",
                    "content": "请介绍你的项目。",
                    "metadata": {"kind": "question"},
                },
                {
                    "id": "turn-2",
                    "session_id": "session-1",
                    "turn_no": 2,
                    "speaker": "candidate",
                    "content": (
                        "我负责模型训练、数据处理和部署，并解决了线上延迟问题。"
                        "具体做法是把数据集、模型、训练入口和评估脚本拆开，配置集中管理，"
                        "同时固定随机种子和版本，部署时用批量推理和缓存降低响应耗时。"
                    ),
                    "metadata": {},
                },
            ],
            "interview_reports": [
                {
                    "id": "report-1",
                    "session_id": "session-1",
                    "interview_id": "interview-1",
                    "overall_score": None,
                    "recommendation": "needs_review",
                    "summary": "The AI interview is complete and waiting for human confirmation before the final report is generated.",
                }
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "completed"}],
        }
        lost_session_response = {
            "response": {
                "status": "error",
                "message": "Session not found.",
                "final_report": None,
            },
            "state_snapshot": {},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-04-29T12:00:00+00:00"),
            patch.object(main, "agent_fetch", return_value=lost_session_response) as agent_fetch,
        ):
            result = main.score_interview(
                main.ScoreInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        agent_fetch.assert_called_once_with(
            "/agent/status?session_id=session-1",
            method="GET",
        )
        report = result["report"]
        self.assertIsInstance(report["overall_score"], int)
        self.assertGreater(report["overall_score"], 0)
        self.assertEqual(report["recommendation"], "hold")
        self.assertNotIn("waiting for human confirmation", report["summary"])


if __name__ == "__main__":
    unittest.main()
