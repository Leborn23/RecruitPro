import os
import unittest.mock as mock

from src.agent.llm_service import LLMService
from src.agent.schemas import JobProfile


def test_fail_fast_mode_enforcement():
    """Demo/prod should fail fast without provider credentials."""
    with mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "manual_openai",
            "OPENAI_API_KEY": "",
            "API_KEY": "",
            "OPENAI_BASE_URL": "",
            "BASE_URL": "",
            "AGENT_MODE": "demo",
        },
    ):
        service = LLMService()
        assert service.mode == "demo"
        assert service.api_key == ""

        try:
            service.invoke_structured("A", "B", JobProfile)
            assert False, "Should have raised RuntimeError in demo mode without key"
        except RuntimeError as exc:
            assert "CRITICAL:" in str(exc)


def test_dev_mode_fallback():
    """Dev mode should fall back to mock outputs instead of crashing."""
    with mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "manual_openai",
            "OPENAI_API_KEY": "",
            "API_KEY": "",
            "OPENAI_BASE_URL": "",
            "BASE_URL": "",
            "AGENT_MODE": "dev",
        },
    ):
        service = LLMService()
        profile = service.invoke_structured("A", "B", JobProfile)
        assert profile.title == "Mock AI"
