from src.agent.llm.base import BaseLLMProvider
from src.agent.llm.config import ProviderConfig

class AnthropicAdapter(BaseLLMProvider):
    """ Dedicated adapter for Anthropic Claude. """
    def __init__(self, model: str, api_key: str):
        self._model = model
        self._api_key = api_key
        # 当前为占位实现；后续接入官方 SDK 时在这里初始化 client。
        self.client = None
    
    def invoke_structured(self, system: str, user: str, schema, model_override=None):
        # 占位：未接入真实 Anthropic structured output。
        return None

    def invoke_plain(self, system: str, user: str, model_override=None):
        return "Anthropic Stub: Not fully implemented yet."
    
    @property
    def provider_name(self): return "anthropic"

class GeminiAdapter(BaseLLMProvider):
    """ Dedicated adapter for Google Gemini. """
    def __init__(self, model: str, api_key: str):
        self._model = model
        self._api_key = api_key
        # 当前为占位实现；后续接入 Google SDK 时在这里初始化 client。
        self.client = None
    
    def invoke_structured(self, system: str, user: str, schema, model_override=None):
        # 占位：未接入真实 Gemini structured output。
        return None

    def invoke_plain(self, system: str, user: str, model_override=None):
        return "Gemini Stub: Not fully implemented yet."
    
    @property
    def provider_name(self): return "gemini"
