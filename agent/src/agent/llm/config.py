import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator, Optional


def _first_non_empty_env(*keys: str) -> Optional[str]:
    """Return the first non-empty env var value among candidate keys."""
    for key in keys:
        val = os.getenv(key)
        if val is not None and val.strip() != "":
            return val.strip()
    return None

@dataclass
class ProviderConfig:
    # provider_name: 供应商标识（openai/deepseek/qwen...）
    # model: 模型名（例如 deepseek-v3.2）
    # api_key/base_url: OpenAI-compatible 统一鉴权入口
    # endpoint_id: 某些供应商额外需要（如 Doubao）
    provider_name: str
    model: str
    api_key: Optional[str]
    base_url: Optional[str] = None
    endpoint_id: Optional[str] = None


_llm_override: ContextVar[Optional[ProviderConfig]] = ContextVar("llm_override", default=None)


@contextmanager
def use_llm_config_override(config: Optional[ProviderConfig]) -> Iterator[None]:
    """临时覆盖 LLM 配置（常用于测试或单次调用切换模型）。"""
    token = _llm_override.set(config)
    try:
        yield
    finally:
        _llm_override.reset(token)

def get_llm_config() -> ProviderConfig:
    """ Reads the environment to determine the active LLM provider and its settings. """
    override = _llm_override.get()
    if override is not None:
        return override

    # 全局统一入口：优先读取 LLM_PROVIDER。
    # 如果用户只给了 API_KEY/BASE_URL，也能走共享变量兜底。
    provider = os.getenv("LLM_PROVIDER", "openai").lower()
    shared_api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key")
    shared_base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url")
    
    # 默认值：即使环境变量缺省，也有基础回退，避免直接 None 崩溃。
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    api_key = None
    base_url = None
    endpoint_id = None
    
    if provider == "openai":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "OPENAI_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "OPENAI_BASE_URL") or "https://api.openai.com/v1"
    elif provider == "moonshot":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "MOONSHOT_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "MOONSHOT_BASE_URL") or "https://api.moonshot.cn/v1"
    elif provider == "qwen":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "DASHSCOPE_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "DASHSCOPE_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        # 如果用户没显式设模型，就使用供应商更常见的默认模型。
        model = model if model != "gpt-4o-mini" else "qwen-turbo"
    elif provider == "deepseek":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "DEEPSEEK_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
        model = model if model != "gpt-4o-mini" else "deepseek-chat"
    elif provider == "doubao":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "VOLCENGINE_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "VOLCENGINE_API_ENDPOINT") or "https://ark.cn-beijing.volces.com/api/v3"
        endpoint_id = os.getenv("VOLCENGINE_ENDPOINT_ID")
    elif provider == "anthropic":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "ANTHROPIC_API_KEY")
        model = model if model != "gpt-4o-mini" else "claude-3-5-sonnet-20240620"
    elif provider == "gemini":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "GEMINI_API_KEY")
        model = model if model != "gpt-4o-mini" else "gemini-1.5-flash"
    elif provider == "manual_openai":
        api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key", "OPENAI_API_KEY")
        base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url", "OPENAI_BASE_URL")
    else:
        # 未知 provider 名称时，退回到通用 API_KEY + BASE_URL。
        api_key = shared_api_key
        base_url = shared_base_url
        
    return ProviderConfig(
        provider_name=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        endpoint_id=endpoint_id
    )
