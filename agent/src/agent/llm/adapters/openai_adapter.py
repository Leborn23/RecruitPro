import json
import logging
import os
import time
from typing import Optional, Type

from pydantic import BaseModel, ValidationError

from src.agent.llm.base import BaseLLMProvider, T


logger = logging.getLogger(__name__)


def _max_llm_retries() -> int:
    try:
        return max(1, int(os.getenv("LLM_MAX_RETRIES", "3")))
    except ValueError:
        return 3


def _retry_delay_seconds(attempt: int) -> float:
    try:
        base = max(0.1, float(os.getenv("LLM_RETRY_BASE_SECONDS", "0.8")))
    except ValueError:
        base = 0.8
    return base * (2 ** max(0, attempt - 1))

try:
    from openai import OpenAI

    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

try:
    from langsmith.wrappers import wrap_openai

    HAS_LANGSMITH_OPENAI_WRAPPER = True
except ImportError:
    HAS_LANGSMITH_OPENAI_WRAPPER = False


class OpenAIAdapter(BaseLLMProvider):
    """Adapter for OpenAI and OpenAI-compatible providers."""

    def __init__(self, model: str, api_key: str, base_url: str, provider_name: str = "openai"):
        self._model = model
        self._api_key = api_key
        self._base_url = base_url
        self._provider_name = provider_name
        self.client = None

        # 兼容“代理网关仅 base_url、无真实 key”的本地开发场景。
        if HAS_OPENAI and (api_key or base_url):
            raw_client = OpenAI(api_key=api_key or "local-dev-key", base_url=base_url)
            self.client = wrap_openai(raw_client) if HAS_LANGSMITH_OPENAI_WRAPPER else raw_client

    def invoke_structured(
        self,
        system_prompt: str,
        user_prompt: str,
        schema: Type[T],
        model_override: Optional[str] = None,
    ) -> T:
        """Invoke model and validate output against schema."""
        model = model_override or self._model

        # 策略1：OpenAI 原生结构化输出（成功率更高、后处理更少）。
        if self._provider_name == "openai" and "gpt-4o" in model:
            try:
                temp = 1.0 if self._provider_name == "moonshot" else 0.1
                response = self.client.beta.chat.completions.parse(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format=schema,
                    temperature=temp,
                )
                parsed = response.choices[0].message.parsed
                if parsed:
                    return parsed
            except Exception:
                logger.warning("Native structured parsing failed on OpenAI. Falling back to JSON mode.", exc_info=True)

        # 策略2：通用 JSON 模式 + Pydantic 校验（兼容 OpenAI-like 供应商）。
        json_system_prompt = (
            system_prompt
            + "\n\nCRITICAL: Return JSON object only, with no markdown fences and no extra text."
        )
        last_exc: Exception | None = None
        max_retries = _max_llm_retries()
        for attempt in range(1, max_retries + 1):
            content = self.invoke_plain(json_system_prompt, user_prompt, model_override=model) or ""

            if "```json" in content:
                content = content.split("```json")[-1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[-1].split("```")[0].strip()

            try:
                data = json.loads(content)

                # 自动修复：模型常把结果包在一层 schema 名字字段里。
                if isinstance(data, dict) and len(data) == 1:
                    key = list(data.keys())[0]
                    key_l = key.lower()
                    expected = schema.__name__.lower()
                    if expected in key_l or key_l in expected:
                        logger.info("Unwrapped nested JSON key from model response: %s", key)
                        data = data[key]

                return schema.model_validate(data)
            except (json.JSONDecodeError, ValidationError, KeyError) as exc:
                last_exc = exc
                logger.warning(
                    "Structured validation failed for provider %s on attempt %s/%s. content_prefix=%r error=%s",
                    self._provider_name,
                    attempt,
                    max_retries,
                    content[:160],
                    exc,
                )
                if attempt >= max_retries:
                    break
                user_prompt = (
                    user_prompt
                    + "\n\nPrevious response was invalid JSON or failed schema validation. "
                    + f"Return one valid JSON object matching {schema.__name__} only."
                )
                time.sleep(_retry_delay_seconds(attempt))

        raise last_exc or RuntimeError("Structured validation failed")

    def invoke_plain(
        self,
        system_prompt: str,
        user_prompt: str,
        model_override: Optional[str] = None,
    ) -> str:
        model = model_override or self._model
        if not self.client:
            raise RuntimeError(f"OpenAI client not initialized for {self._provider_name}. Missing API key.")

        # JSON 场景降温以稳结构；普通对话保持较自然温度。
        temp = 1.0 if self._provider_name == "moonshot" else (0.1 if "json" in system_prompt.lower() else 0.7)

        last_exc: Exception | None = None
        max_retries = _max_llm_retries()
        for attempt in range(1, max_retries + 1):
            try:
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temp,
                )
                return response.choices[0].message.content
            except Exception as exc:
                last_exc = exc
                if attempt >= max_retries:
                    break
                logger.warning("LLM request failed, retrying attempt %s/%s: %s", attempt, max_retries, exc)
                time.sleep(_retry_delay_seconds(attempt))
        raise last_exc or RuntimeError("LLM request failed")

    def invoke_with_tools(
        self,
        system_prompt: str,
        user_prompt: str,
        tools: list,
        tool_executor,
        max_rounds: int = 3,
    ) -> str:
        """Multi-turn tool-calling loop."""
        if not self.client:
            raise RuntimeError(f"OpenAI client not initialized for {self._provider_name}.")

        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        # 最多多轮工具调用，防止模型循环调用工具不收敛。
        for _ in range(max_rounds):
            response = self.client.chat.completions.create(
                model=self._model,
                messages=messages,
                tools=tools,
                temperature=0.3,
            )
            choice = response.choices[0]

            message = choice.message
            tool_calls = message.tool_calls or []

            if choice.finish_reason == "tool_calls" or tool_calls:
                assistant_message = {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [],
                }

                messages.append(assistant_message)

                # 每个 tool_call 都要追加对应 tool 响应，保持 OpenAI 消息协议完整。
                for tc in tool_calls:
                    func_name = tc.function.name
                    func_args = tc.function.arguments
                    logger.info("Tool call requested: %s(%s...)", func_name, func_args[:80])
                    assistant_message["tool_calls"].append(
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": func_name, "arguments": func_args},
                        }
                    )
                    result = tool_executor(func_name, func_args)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": str(result),
                        }
                    )
            else:
                return choice.message.content or ""

        return messages[-1].get("content", "Research completed but no summary generated.")

    @property
    def provider_name(self) -> str:
        return self._provider_name
