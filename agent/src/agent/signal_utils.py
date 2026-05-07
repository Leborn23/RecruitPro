"""Signal detection helpers for interview interaction quality."""

from __future__ import annotations

import re

# 仅这句“固定话术”触发一次重述，避免把“不会”误判成“求解释”。
FIXED_CLARIFICATION_SENTENCE = "\u6211\u4e0d\u592a\u61c2\u8fd9\u4e2a\u95ee\u9898\uff0c\u4f60\u53ef\u4ee5\u8be6\u7ec6\u8bf4\u660e\u4e00\u4e0b\u5417"

INEXPERIENCED_OR_CANNOT_ANSWER_SIGNALS = [
    "\u4e0d\u4f1a",
    "\u6211\u4e0d\u4f1a",
    "\u4e0d\u4f1a\u505a",
    "\u6ca1\u505a\u8fc7",
    "\u6ca1\u5b66\u8fc7",
    "\u4e0d\u4e86\u89e3",
    "\u4e0d\u719f",
    "\u4e0d\u77e5\u9053",
    "\u4e0d\u592a\u4f1a",
    "\u4e0d\u6e05\u695a",
    "\u5fd8\u4e86",
    "\u60f3\u4e0d\u8d77\u6765",
    "\u7b54\u4e0d\u4e0a\u6765",
    "\u65e0\u7ecf\u9a8c",
    "\u6ca1\u7ecf\u9a8c",
    "\u7b2c\u4e00\u6b21\u542c\u8bf4",
    "idk",
    "dont know",
    "don't know",
    "not sure",
    "no idea",
    "never used",
    "not familiar",
]


def _normalize(text: str) -> str:
    # 统一预处理：去空白 + 小写，确保中英混合匹配稳定。
    return (text or "").strip().lower()


def _compact_for_exact_match(text: str) -> str:
    normalized = _normalize(text)
    # 精确句匹配前移除空格和标点，避免输入法差异导致匹配失败。
    return re.sub(r"[\s\,\，\.\。\?\？\!\！\;\；\:\：\"\'\“\”\(\)\（\）]", "", normalized)


def is_fixed_clarification_request(answer: str) -> bool:
    """Only this specific request sentence should trigger restatement."""
    if not answer:
        return False
    expected = _compact_for_exact_match(FIXED_CLARIFICATION_SENTENCE)
    got = _compact_for_exact_match(answer)
    return got == expected


def is_cannot_answer_signal(answer: str) -> bool:
    """Capability inability signals that should be scored low and switch direction."""
    text = _normalize(answer)
    if not text:
        return True

    # 终端编码降级兜底：部分 shell 会把中文变成 ???，这里按“无法作答”处理。
    if text in {"?", "??", "???", "????", "？", "？？", "？？？", "？？？？"}:
        return True
    q_count = text.count("?") + text.count("？")
    if q_count >= 2 and q_count / max(1, len(text)) >= 0.5:
        return True

    return any(signal in text for signal in INEXPERIENCED_OR_CANNOT_ANSWER_SIGNALS)


def is_low_info_answer(answer: str) -> bool:
    # 低信息回答用于“是否值得追问”的判定，不直接决定评分。
    text = _normalize(answer)
    if len(text) < 8:
        return True
    low_info_markers = [
        "\u4e0d\u4f1a",
        "\u4e0d\u77e5\u9053",
        "\u4e0d\u6e05\u695a",
        "\u4e0d\u592a\u4f1a",
        "\u4e0d\u61c2",
        "\u6ca1\u5b66\u8fc7",
        "\u5c0f\u767d",
        "\u6ca1\u6709",
        "\u968f\u4fbf",
        "idk",
        "no idea",
        "not sure",
    ]
    return any(marker in text for marker in low_info_markers)
