"""LangGraph checkpoint 反序列化兼容辅助。

为什么需要这个文件：
1) 我们在 state 里存了 Pydantic 模型（如 CandidateProfile）。
2) LangGraph 在恢复 checkpoint 时会校验“允许反序列化的类型”。
3) 不注册会出现大量 warning，未来版本甚至可能直接拒绝恢复。
"""

from __future__ import annotations

from typing import Iterable

MSGPACK_ALLOWED_TYPES: tuple[tuple[str, str], ...] = (
    # 这里列出会出现在 checkpoint 中的核心结构化类型。
    # tuple 形式是 (模块路径, 类名)，与 LangGraph 提示格式保持一致。
    ("src.agent.schemas", "JobProfile"),
    ("src.agent.schemas", "CandidateProfile"),
    ("src.agent.schemas", "GapAnalysis"),
    ("src.agent.schemas", "InterviewQuestion"),
    ("src.agent.schemas", "InterviewPlan"),
    ("src.agent.schemas", "ScoreDimensions"),
    ("src.agent.schemas", "AnswerEvaluation"),
    ("src.agent.schemas", "HireRecommendation"),
    ("src.agent.schemas", "RiskLevel"),
    ("src.agent.schemas", "ResumeRisk"),
    ("src.agent.schemas", "AuditResult"),
    ("src.agent.schemas", "EvidenceItem"),
    ("src.agent.schemas", "FinalInterviewReport"),
    ("src.agent.schemas", "HumanReviewDecision"),
    ("src.agent.state", "StopReason"),
)


def get_msgpack_allowed_types() -> Iterable[tuple[str, str]]:
    """供外部查询当前允许列表（例如调试或测试验证）。"""
    return MSGPACK_ALLOWED_TYPES


def register_msgpack_allowed_types_legacy() -> None:
    """Legacy no-op compatibility path for older LangGraph versions."""
    try:
        from langgraph.checkpoint.serde.msgpack import ALLOWED_MSGPACK_MODULES
    except Exception:
        return

    # 旧版本支持直接注册 module 名称。
    ALLOWED_MSGPACK_MODULES.add("src.agent.schemas")
    ALLOWED_MSGPACK_MODULES.add("src.agent.state")

    # 新提示推荐注册到类级 tuple，兼容未来更严格校验。
    for item in MSGPACK_ALLOWED_TYPES:
        ALLOWED_MSGPACK_MODULES.add(item)


# 保持既有导入路径不变，避免改动调用方。
def register_msgpack_allowed_types() -> None:
    register_msgpack_allowed_types_legacy()
