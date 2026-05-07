import os

import pytest

from src.agent.llm_service import LLMService
from src.agent.schemas import JobProfile


def test_fail_fast_in_eval_mode():
    os.environ["AGENT_MODE"] = "eval"
    os.environ["LLM_PROVIDER"] = "manual_openai"
    os.environ["API_KEY"] = ""
    os.environ["BASE_URL"] = ""
    original_key = os.environ.get("OPENAI_API_KEY")
    if "OPENAI_API_KEY" in os.environ:
        del os.environ["OPENAI_API_KEY"]

    service = LLMService()
    with pytest.raises(RuntimeError) as exc_info:
        service.invoke_structured("sys", "user", JobProfile)

    assert "CRITICAL: API Key for manual_openai missing in eval mode." in str(exc_info.value)

    if original_key:
        os.environ["OPENAI_API_KEY"] = original_key
