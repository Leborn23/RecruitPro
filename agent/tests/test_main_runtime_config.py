from fastapi.testclient import TestClient
from uuid import uuid4

from src.agent.api_schemas import AgentActionType
from src.agent.llm_service import default_llm
from src.main import app


def _force_mock_llm(monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "dev")
    monkeypatch.setenv("LLM_PROVIDER", "manual_openai")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("BASE_URL", "")
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    default_llm.reset()


def test_runtime_config_endpoint_reports_snapshot(monkeypatch):
    monkeypatch.setenv("INTERVIEW_MIN_QUESTIONS", "2")
    monkeypatch.setenv("INTERVIEW_MAX_QUESTIONS", "4")
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", "artifacts/checkpoints/api.sqlite")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")

    with TestClient(app) as client:
        response = client.get("/agent/runtime-config", headers={"x-agent-secret": "test-secret"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["interview_question_range"] == "2-4"
    assert payload["checkpoint_backend"] == "sqlite"
    assert payload["checkpoint_location"] == "artifacts/checkpoints/api.sqlite"


def test_unknown_session_status_reports_error(monkeypatch):
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")

    with TestClient(app) as client:
        response = client.get(
            "/agent/status",
            params={"session_id": "missing-api-session"},
            headers={"x-agent-secret": "test-secret"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == {"ready": False, "status": "error"}
    assert payload["response"]["status"] == "error"


def test_answer_unknown_session_reports_error(monkeypatch):
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")

    with TestClient(app) as client:
        response = client.post(
            "/agent/answer",
            json={"session_id": "missing-answer-session", "user_answer": "hello"},
            headers={"x-agent-secret": "test-secret"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "error"
    assert payload["state_snapshot"]["next_nodes"] == []


def test_answer_after_finished_session_reports_error(monkeypatch):
    _force_mock_llm(monkeypatch)
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")
    session_id = f"api-finished-answer-session-{uuid4()}"

    with TestClient(app) as client:
        response = client.post(
            "/agent/start",
            json={"session_id": session_id, "resume_text": "Python dev", "jd_text": "Need Python dev"},
            headers={"x-agent-secret": "test-secret"},
        )
        payload = response.json()
        while payload["status"] == AgentActionType.ASK.value:
            response = client.post(
                "/agent/answer",
                json={"session_id": session_id, "user_answer": "Some answer"},
                headers={"x-agent-secret": "test-secret"},
            )
            payload = response.json()

        assert payload["status"] == AgentActionType.WAIT_FOR_REVIEW.value

        response = client.post(
            "/agent/review",
            json={"session_id": session_id, "approved": True, "comments": "Approved by HR"},
            headers={"x-agent-secret": "test-secret"},
        )
        assert response.json()["status"] == AgentActionType.FINISH.value

        response = client.post(
            "/agent/answer",
            json={"session_id": session_id, "user_answer": "Late answer"},
            headers={"x-agent-secret": "test-secret"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == AgentActionType.ERROR.value


def test_answer_endpoint_returns_partial_evaluation(monkeypatch):
    _force_mock_llm(monkeypatch)
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")
    session_id = f"api-partial-eval-session-{uuid4()}"
    answer_text = "I don't know"

    with TestClient(app) as client:
        client.post(
            "/agent/start",
            json={"session_id": session_id, "resume_text": "Python dev", "jd_text": "Need Python dev"},
            headers={"x-agent-secret": "test-secret"},
        )
        response = client.post(
            "/agent/answer",
            json={"session_id": session_id, "user_answer": answer_text},
            headers={"x-agent-secret": "test-secret"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == AgentActionType.ASK.value
    assert payload["partial_eval"]["answer"] == answer_text
    assert payload["partial_eval"]["dimensions"]["technical_depth"] == 1


def test_duplicate_start_reports_error_without_overwriting_session(monkeypatch):
    _force_mock_llm(monkeypatch)
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")
    session_id = f"api-duplicate-start-session-{uuid4()}"

    with TestClient(app) as client:
        first = client.post(
            "/agent/start",
            json={"session_id": session_id, "resume_text": "Python dev", "jd_text": "Need Python dev"},
            headers={"x-agent-secret": "test-secret"},
        )
        second = client.post(
            "/agent/start",
            json={"session_id": session_id, "resume_text": "Different candidate", "jd_text": "Different job"},
            headers={"x-agent-secret": "test-secret"},
        )

    assert first.status_code == 200
    assert first.json()["status"] == AgentActionType.ASK.value
    assert second.status_code == 200
    payload = second.json()
    assert payload["status"] == AgentActionType.ERROR.value
    assert payload["state_snapshot"]["asked_question_count"] == 1


def test_start_accepts_request_question_count(monkeypatch):
    _force_mock_llm(monkeypatch)
    monkeypatch.setenv("INTERVIEW_MIN_QUESTIONS", "2")
    monkeypatch.setenv("INTERVIEW_MAX_QUESTIONS", "5")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")
    session_id = f"api-question-count-session-{uuid4()}"

    with TestClient(app) as client:
        response = client.post(
            "/agent/start",
            json={
                "session_id": session_id,
                "resume_text": "Python dev",
                "jd_text": "Need Python dev",
                "question_count": 3,
            },
            headers={"x-agent-secret": "test-secret"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == AgentActionType.ASK.value
    assert payload["state_snapshot"]["planned_question_count"] == 3
