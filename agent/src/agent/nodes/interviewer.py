"""Interviewer node module."""

import logging
from typing import Any, Dict

from langchain_core.messages import AIMessage

from src.agent.llm_service import default_llm
from src.agent.prompts.interviewer_prompts import (
    ASK_QUESTION_PROMPT,
    CLARIFICATION_PROMPT,
    FOLLOW_UP_PROMPT,
)
from src.agent.state import InterviewState


logger = logging.getLogger(__name__)
FOLLOW_UP_PREFIX = "（追问）"


def ask_next_question_node(state: InterviewState) -> Dict[str, Any]:
    """Ask the next planned interview question."""
    asked = state.get("asked_questions", [])
    plan = state.get("interview_plan")

    if not plan or len(asked) >= len(plan.questions):
        return {}

    next_question = plan.questions[len(asked)]

    # 优先使用计划阶段预生成的问题文案，减少实时 LLM 调用时延。
    if next_question.rendered_text:
        logger.info("Delivering pre-rendered question %s/%s.", len(asked) + 1, len(plan.questions))
        conversational_question = next_question.rendered_text.strip()
    else:
        logger.info("Missing rendered question text. Calling LLM for question %s.", len(asked) + 1)
        conversational_question = default_llm.invoke_plain(
            system_prompt=ASK_QUESTION_PROMPT.format(
                topic=next_question.topic,
                planned_question=next_question.question_text,
                turn_count=len(asked),
            ),
            user_prompt="Deliver the next interview question.",
        ).strip()

    # asked_questions 记录“计划题干”，messages 记录“候选人看到的话术”。
    return {
        "asked_questions": [next_question.question_text],
        "messages": [AIMessage(content=conversational_question)],
    }


def ask_follow_up_node(state: InterviewState) -> Dict[str, Any]:
    """Ask one follow-up question for missing answer elements."""
    last_eval = state.get("last_evaluation")
    if not last_eval or not last_eval.missing_logic_elements:
        return {}

    gaps_str = ", ".join(last_eval.missing_logic_elements)
    logger.info("Asking follow-up for gaps: %s", gaps_str)

    # 追问只问一个点，避免把候选人再次问懵。
    conversational_follow_up = default_llm.invoke_plain(
        system_prompt=FOLLOW_UP_PROMPT.format(
            gaps=gaps_str,
            last_question=last_eval.question,
            last_answer=last_eval.answer,
        ),
        user_prompt="Ask one concise follow-up question now.",
    ).strip()

    if conversational_follow_up and not conversational_follow_up.startswith(FOLLOW_UP_PREFIX):
        conversational_follow_up = f"{FOLLOW_UP_PREFIX} {conversational_follow_up}"

    return {"messages": [AIMessage(content=conversational_follow_up)]}


def ask_clarification_node(state: InterviewState) -> Dict[str, Any]:
    """Ask a simpler retry question when candidate indicates confusion."""
    asked = state.get("asked_questions", [])
    answers = state.get("answers", [])
    if not asked or not answers:
        return {}

    last_question = asked[-1]
    last_answer = answers[-1]
    logger.info("Clarification branch triggered for candidate understanding.")

    # 澄清节点只负责“重述+缩小范围”，不改变主流程状态结构。
    clarification = default_llm.invoke_plain(
        system_prompt=CLARIFICATION_PROMPT.format(
            last_question=last_question,
            last_answer=last_answer,
        ),
        user_prompt="Rewrite and ask a simpler retry question now.",
    ).strip()
    return {"messages": [AIMessage(content=clarification)]}
