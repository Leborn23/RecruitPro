from abc import ABC, abstractmethod
from typing import Type, TypeVar, Optional, List, Dict, Any, Callable
from pydantic import BaseModel

T = TypeVar('T', bound=BaseModel)

class BaseLLMProvider(ABC):
    """ Abstract Base Class for all LLM Providers (OpenAI, Anthropic, Gemini, etc.) """
    
    @abstractmethod
    def invoke_structured(self, system_prompt: str, user_prompt: str, schema: Type[T], model_override: Optional[str] = None) -> T:
        """结构化调用：要求模型输出可解析为 schema 的 JSON，再反序列化为 Pydantic 对象。"""
        pass

    @abstractmethod
    def invoke_plain(self, system_prompt: str, user_prompt: str, model_override: Optional[str] = None) -> str:
        """普通文本调用：返回自然语言字符串。"""
        pass

    def invoke_with_tools(
        self, 
        system_prompt: str, 
        user_prompt: str, 
        tools: List[Dict[str, Any]], 
        tool_executor: Callable[[str, str], str],
        max_rounds: int = 3
    ) -> str:
        """
        Multi-turn tool-calling loop. 
        Default implementation: ignore tools and just call invoke_plain.
        Providers that support tool calling should override this.
        """
        # 默认实现不支持工具调用，直接退回 plain 文本。
        return self.invoke_plain(system_prompt, user_prompt)

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """返回供应商标识字符串，用于日志与分支路由。"""
        pass
