"""
Telemetry & Tracing Configuration
Responsibility: Local structured JSON logging and custom sanitization for LLM inputs/outputs.
"""
import logging
import json
from typing import Any, Dict, Optional
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

logger = logging.getLogger("AgentTelemetry")
logger.setLevel(logging.INFO)
# Basic console standard logging format for local
formatter = logging.Formatter('{"time": "%(asctime)s", "level": "%(levelname)s", "event": %(message)s}')
ch = logging.StreamHandler()
ch.setFormatter(formatter)
if not logger.handlers:
    logger.addHandler(ch)

class LocalStructuredTracer(BaseCallbackHandler):
    """
    Custom LangChain Callback Handler to dump strictly formatted JSON line logs
    locally, while ensuring sensitive raw objects are truncated or sanitized.
    """
    
    def on_llm_start(self, serialized: Dict[str, Any], prompts: list[str], **kwargs: Any) -> None:
        """Called when LLM starts running. Sanitizes full prompts to avoid massive raw dump."""
        # 只记录前 100 字符摘要，避免日志泄露过多候选人隐私信息。
        safe_prompts = [p[:100] + "...[SANITIZED]" if len(p) > 100 else p for p in prompts]
        event = {
            "type": "llm_start",
            "model": serialized.get("name", "unknown_model"),
            "prompts_preview": safe_prompts,
            "run_id": str(kwargs.get("run_id"))
        }
        logger.info(json.dumps(event))

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Called when LLM finishes running."""
        try:
            # 不同供应商返回 token 字段可能不一致，这里走容错读取。
            tokens = response.llm_output.get("token_usage", {}) if response.llm_output else {}
            # 只保留输出预览，避免长文本污染本地日志。
            generations = [g[0].text[:100] + "...[TRUNCATED]" for g in response.generations if g]
            
            event = {
                "type": "llm_end",
                "run_id": str(kwargs.get("run_id")),
                "tokens": tokens,
                "output_preview": generations
            }
            logger.info(json.dumps(event))
        except Exception:
            logger.error(json.dumps({"type": "llm_end_error", "msg": "Failed to parse LLM result for logs."}))

    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **kwargs: Any) -> None:
        logger.info(json.dumps({"type": "tool_start", "tool": serialized.get("name")}))

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        logger.info(json.dumps({"type": "tool_end", "output_length": len(output)}))
