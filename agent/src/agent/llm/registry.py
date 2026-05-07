from typing import Dict, Type, Optional
from src.agent.llm.base import BaseLLMProvider
from src.agent.llm.config import ProviderConfig, get_llm_config
from src.agent.llm.adapters.openai_adapter import OpenAIAdapter
from src.agent.llm.adapters.non_openai import AnthropicAdapter, GeminiAdapter

class ProviderRegistry:
    """ Registry and Factory for all LLM Providers. """
    
    _adapters: Dict[str, Type[BaseLLMProvider]] = {
        "openai": OpenAIAdapter,
        "moonshot": OpenAIAdapter,
        "qwen": OpenAIAdapter,
        "deepseek": OpenAIAdapter,
        "doubao": OpenAIAdapter,
        "manual_openai": OpenAIAdapter,
        "anthropic": AnthropicAdapter,
        "gemini": GeminiAdapter
    }

    @classmethod
    def get_provider(cls, config: Optional[ProviderConfig] = None) -> BaseLLMProvider:
        """ Returns the active provider based on current config. """
        if config is None:
            # 默认从环境变量读取配置。
            config = get_llm_config()
            
        adapter_cls = cls._adapters.get(config.provider_name)
        if not adapter_cls:
            raise ValueError(f"Unknown LLM Provider: {config.provider_name}")
            
        # OpenAIAdapter 兼容所有 OpenAI-like base_url（deepseek/qwen/moonshot/doubao）。
        if adapter_cls is OpenAIAdapter:
            return OpenAIAdapter(
                model=config.model,
                api_key=config.api_key or "",
                base_url=config.base_url or "https://api.openai.com/v1",
                provider_name=config.provider_name
            )
        else:
            # 非 OpenAI 供应商走各自原生 adapter。
            return adapter_cls(model=config.model, api_key=config.api_key or "")
