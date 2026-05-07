import os
import unittest.mock as mock

from src.agent.llm.config import get_llm_config
from src.agent.llm.registry import ProviderRegistry
from src.agent.llm_service import LLMService
from src.agent.schemas import JobProfile


def test_llm_config_resolution():
    with mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "qwen",
            "API_KEY": "",
            "BASE_URL": "",
            "DASHSCOPE_API_KEY": "sk-qwen-key",
            "LLM_MODEL": "qwen-max",
        },
    ):
        config = get_llm_config()
        assert config.provider_name == "qwen"
        assert config.api_key == "sk-qwen-key"
        assert config.model == "qwen-max"
        assert "dashscope.aliyuncs.com" in config.base_url


def test_provider_registry_returns_correct_adapter():
    with mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "deepseek",
            "API_KEY": "",
            "BASE_URL": "",
            "DEEPSEEK_API_KEY": "sk-ds",
        },
    ):
        config = get_llm_config()
        provider = ProviderRegistry.get_provider(config)
        assert provider.provider_name == "deepseek"
        from src.agent.llm.adapters.openai_adapter import OpenAIAdapter

        assert isinstance(provider, OpenAIAdapter)


def test_llm_service_facade_mock_fallback():
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
