import os
import uuid

import pytest

from src.agent.api_schemas import AgentActionType
from src.agent.llm_service import default_llm
from src.agent.runtime import InterviewAgentRuntime


def _has_provider_credentials(provider: str) -> bool:
    provider_key_map = {
        "openai": ("OPENAI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "moonshot": ("MOONSHOT_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "qwen": ("DASHSCOPE_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "deepseek": ("DEEPSEEK_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "doubao": ("VOLCENGINE_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "anthropic": ("ANTHROPIC_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "gemini": ("GEMINI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
        "manual_openai": ("OPENAI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
    }
    return any(os.getenv(key, "").strip() for key in provider_key_map.get(provider, ("API_KEY", "LLM_API_KEY")))


@pytest.mark.real_llm
def test_real_llm_runtime_reaches_first_candidate_question(monkeypatch):
    if os.getenv("RUN_REAL_LLM_SMOKE", "").strip() != "1":
        pytest.skip("Set RUN_REAL_LLM_SMOKE=1 to run the real-provider smoke test.")

    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if not _has_provider_credentials(provider):
        pytest.skip(f"Missing credentials for provider {provider}.")

    monkeypatch.setenv("AGENT_MODE", "demo")
    monkeypatch.setenv("AGENT_CHECKPOINT_BACKEND", "memory")
    default_llm.reset()

    runtime = InterviewAgentRuntime()
    try:
        response = runtime.start_interview(
            resume_text=(
                "Candidate: Lin Chen. Python backend engineer with 5 years of experience. "
                "Built FastAPI services, PostgreSQL schemas, Redis caching, and async task workers. "
                "Led a migration that reduced API latency by 35%."
            ),
            jd_text=(
                "Backend engineer role requiring Python, FastAPI, PostgreSQL, distributed systems basics, "
                "debugging skills, and clear communication."
            ),
            thread_id=f"real-llm-smoke-{uuid.uuid4()}",
        )
    finally:
        runtime.close()
        default_llm.reset()

    assert response.status == AgentActionType.ASK
    assert response.message and len(response.message.strip()) >= 10
    assert response.candidate_profile is not None
    assert response.job_profile is not None
    assert response.interview_plan is not None
    assert len(response.interview_plan.questions) >= 1
