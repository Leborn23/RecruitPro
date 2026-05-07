import importlib
import threading
import time
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.agent.llm_service import default_llm
from src.agent.runtime import InterviewAgentRuntime
from src.agent.schemas import AnswerEvaluation, InterviewPlan


def _build_questions(count: int) -> list[dict]:
    return [
        {
            "topic": f"topic-{idx}",
            "question_text": f"question-{idx}",
            "expected_key_points": [f"point-{idx}"],
            "rendered_text": f"rendered-{idx}",
            "answer_guidance": f"guidance-{idx}",
        }
        for idx in range(count)
    ]


def test_interview_plan_respects_configured_question_bounds(monkeypatch):
    monkeypatch.setenv("INTERVIEW_MIN_QUESTIONS", "2")
    monkeypatch.setenv("INTERVIEW_MAX_QUESTIONS", "3")

    plan = InterviewPlan.model_validate(
        {
            "questions": _build_questions(4),
            "estimated_duration_minutes": 30,
        }
    )

    assert len(plan.questions) == 3

    with pytest.raises(ValidationError):
        InterviewPlan.model_validate(
            {
                "questions": _build_questions(1),
                "estimated_duration_minutes": 30,
            }
        )


def test_interview_plan_uses_request_question_count_override(monkeypatch):
    monkeypatch.setenv("INTERVIEW_MIN_QUESTIONS", "2")
    monkeypatch.setenv("INTERVIEW_MAX_QUESTIONS", "5")

    interview_config = importlib.import_module("src.agent.interview_config")

    with interview_config.interview_question_count_override(3):
        plan = InterviewPlan.model_validate(
            {
                "questions": _build_questions(5),
                "estimated_duration_minutes": 30,
            }
        )

    assert len(plan.questions) == 3

    with interview_config.interview_question_count_override(3), pytest.raises(ValidationError):
        InterviewPlan.model_validate(
            {
                "questions": _build_questions(2),
                "estimated_duration_minutes": 30,
            }
        )


def test_checkpoint_factory_uses_memory_backend_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_CHECKPOINT_BACKEND", raising=False)
    checkpoint_factory = importlib.import_module("src.agent.checkpoint_factory")

    saver = checkpoint_factory.create_checkpointer()

    assert saver.__class__.__name__ in {"MemorySaver", "InMemorySaver"}


def test_checkpoint_factory_builds_sqlite_backend(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", str(tmp_path / "checkpoints.sqlite"))
    checkpoint_factory = importlib.import_module("src.agent.checkpoint_factory")
    saver = checkpoint_factory.create_checkpointer()

    assert saver.__class__.__name__ == "SqliteSaver"
    owned_conn = getattr(saver, "_owned_sqlite_conn", None)
    assert owned_conn is not None
    owned_conn.close()


def test_checkpoint_factory_uses_default_sqlite_path(monkeypatch):
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.delenv("AGENT_CHECKPOINT_SQLITE_PATH", raising=False)
    checkpoint_factory = importlib.import_module("src.agent.checkpoint_factory")

    saver = checkpoint_factory.create_checkpointer()

    assert saver.__class__.__name__ == "SqliteSaver"
    owned_conn = getattr(saver, "_owned_sqlite_conn", None)
    assert owned_conn is not None
    owned_conn.close()


def test_session_lock_manager_serializes_same_session():
    concurrency = importlib.import_module("src.agent.concurrency")
    manager = concurrency.SessionLockManager()

    current = 0
    peak = 0
    gate = threading.Barrier(2)
    done = []

    def worker():
        nonlocal current, peak
        gate.wait()
        with manager.locked("same-session"):
            current += 1
            peak = max(peak, current)
            time.sleep(0.05)
            current -= 1
            done.append(True)

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert peak == 1
    assert len(done) == 2


def test_sqlite_checkpoint_persists_across_runtime_instances(monkeypatch, tmp_path):
    sqlite_path = tmp_path / "runtime-persistence.sqlite"
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", str(sqlite_path))
    monkeypatch.setenv("AGENT_MODE", "dev")
    monkeypatch.setenv("LLM_PROVIDER", "manual_openai")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("BASE_URL", "")
    monkeypatch.setenv("OPENAI_BASE_URL", "")

    default_llm.reset()
    runtime = InterviewAgentRuntime()
    response = runtime.start_interview("Candidate A", "Python dev", thread_id="sqlite-persist")
    runtime.close()

    default_llm.reset()
    new_runtime = InterviewAgentRuntime()
    status = new_runtime.get_session_status("sqlite-persist")
    new_runtime.close()

    assert status.thread_id == "sqlite-persist"
    assert status.message == response.message


def test_runtime_settings_snapshot_reports_config(monkeypatch):
    monkeypatch.setenv("INTERVIEW_MIN_QUESTIONS", "4")
    monkeypatch.setenv("INTERVIEW_MAX_QUESTIONS", "6")
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", "artifacts/checkpoints/interview.sqlite")

    runtime_settings = importlib.import_module("src.agent.runtime_settings")
    snapshot = runtime_settings.get_runtime_settings_snapshot()

    assert snapshot["interview_question_range"] == "4-6"
    assert snapshot["checkpoint_backend"] == "sqlite"
    assert snapshot["checkpoint_location"] == "artifacts/checkpoints/interview.sqlite"


def test_runtime_settings_rejects_sqlite_with_multiple_workers(monkeypatch):
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", "artifacts/checkpoints/interview.sqlite")
    monkeypatch.setenv("AGENT_WORKER_COUNT", "2")

    runtime_settings = importlib.import_module("src.agent.runtime_settings")

    with pytest.raises(RuntimeError, match="sqlite checkpoint backend is single-process only"):
        runtime_settings.validate_runtime_deployment_settings()


def test_runtime_settings_allows_sqlite_with_single_worker(monkeypatch):
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", "artifacts/checkpoints/interview.sqlite")
    monkeypatch.setenv("AGENT_WORKER_COUNT", "1")

    runtime_settings = importlib.import_module("src.agent.runtime_settings")

    runtime_settings.validate_runtime_deployment_settings()


def test_runtime_settings_ignores_platform_web_concurrency(monkeypatch):
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "sqlite")
    monkeypatch.setenv("AGENT_CHECKPOINT_SQLITE_PATH", "artifacts/checkpoints/interview.sqlite")
    monkeypatch.delenv("AGENT_WORKER_COUNT", raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "2")

    runtime_settings = importlib.import_module("src.agent.runtime_settings")

    runtime_settings.validate_runtime_deployment_settings()


def test_openai_adapter_retries_transient_plain_completion_failure(monkeypatch):
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("LLM_RETRY_BASE_SECONDS", "0.1")
    monkeypatch.setattr(time, "sleep", lambda _seconds: None)
    adapter_module = importlib.import_module("src.agent.llm.adapters.openai_adapter")

    class _Completions:
        def __init__(self) -> None:
            self.calls = 0

        def create(self, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("transient connection error")
            message = SimpleNamespace(content="ok")
            choice = SimpleNamespace(message=message)
            return SimpleNamespace(choices=[choice])

    completions = _Completions()
    adapter = adapter_module.OpenAIAdapter("model", "key", "http://example.test")
    adapter.client = SimpleNamespace(chat=SimpleNamespace(completions=completions))

    assert adapter.invoke_plain("system", "user") == "ok"
    assert completions.calls == 2


def test_openai_adapter_retries_invalid_structured_json(monkeypatch):
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("LLM_RETRY_BASE_SECONDS", "0.1")
    monkeypatch.setattr(time, "sleep", lambda _seconds: None)
    adapter_module = importlib.import_module("src.agent.llm.adapters.openai_adapter")

    class _Completions:
        def __init__(self) -> None:
            self.calls = 0

        def create(self, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                content = ""
            else:
                content = json.dumps(
                    {
                        "question": "Q",
                        "answer": "A",
                        "dimensions": {
                            "technical_depth": 6,
                            "communication_logic": 7,
                            "problem_solving": 6,
                        },
                        "feedback": "Valid evaluation",
                        "missing_logic_elements": [],
                    }
                )
            message = SimpleNamespace(content=content)
            choice = SimpleNamespace(message=message)
            return SimpleNamespace(choices=[choice])

    completions = _Completions()
    adapter = adapter_module.OpenAIAdapter("model", "key", "http://example.test")
    adapter.client = SimpleNamespace(chat=SimpleNamespace(completions=completions))

    result = adapter.invoke_structured("system", "user", AnswerEvaluation)

    assert result.dimensions.technical_depth == 6
    assert completions.calls == 2
