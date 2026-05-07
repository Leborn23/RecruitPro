"""Core LangGraph definition module."""

import os

from langgraph.graph import END, START, StateGraph

from src.agent.checkpoint_factory import create_checkpointer
from src.agent.nodes.auditor import audit_resume_node
from src.agent.nodes.interviewer import (
    ask_clarification_node,
    ask_follow_up_node,
    ask_next_question_node,
)
from src.agent.nodes.parser import parse_jd_node, parse_resume_node
from src.agent.nodes.planner import build_gap_analysis_node, build_interview_plan_node
from src.agent.nodes.researcher import researcher_node
from src.agent.nodes.reviewer import (
    evaluate_answer_node,
    finalize_report_node,
    request_human_review_node,
)
from src.agent.signal_utils import (
    is_cannot_answer_signal,
    is_fixed_clarification_request,
    is_low_info_answer,
)
from src.agent.state import InterviewState


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _use_audit() -> bool:
    return _env_flag("AGENT_ENABLE_AUDIT", False)


def _use_researcher() -> bool:
    return _env_flag("AGENT_ENABLE_RESEARCHER", False)


def _is_experience_style_question(question: str) -> bool:
    q = (question or "").lower()
    markers = ["项目", "经历", "场景", "情境", "任务", "行动", "结果", "案例", "负责", "star"]
    return any(marker in q for marker in markers)


def decide_start_entry(state: InterviewState) -> str:
    candidate = state.get("candidate_profile")
    job = state.get("job_profile")
    if candidate and job:
        return "build_gap_analysis"
    if candidate and not job:
        return "parse_jd"
    return "parse_resume"


def decide_after_parse_resume(state: InterviewState) -> str:
    if state.get("job_profile"):
        return "build_gap_analysis"
    return "parse_jd"


def decide_after_parse_jd(state: InterviewState) -> str:
    if _use_audit():
        return "audit_resume"
    return "build_gap_analysis"


def decide_after_audit(state: InterviewState) -> str:
    if _use_researcher():
        return "researcher"
    return "build_gap_analysis"


def decide_next_step(state: InterviewState) -> str:
    plan = state.get("interview_plan")
    asked = state.get("asked_questions", [])
    answers = state.get("answers", [])
    last_eval = state.get("last_evaluation")

    if len(asked) >= 15:
        return "request_human_review"

    latest_answer = answers[-1] if answers else ""
    extra_rounds_used = max(0, len(answers) - len(asked))

    if latest_answer and is_fixed_clarification_request(latest_answer):
        if extra_rounds_used == 0:
            return "ask_clarification"
        if plan and len(asked) >= len(plan.questions):
            return "request_human_review"
        return "ask_next_question"

    if latest_answer and is_cannot_answer_signal(latest_answer):
        if plan and len(asked) >= len(plan.questions):
            return "request_human_review"
        return "ask_next_question"

    if last_eval and last_eval.missing_logic_elements:
        if "clarification_needed" in last_eval.missing_logic_elements:
            return "ask_next_question"
        already_followed_up_for_this_question = len(answers) > len(asked)
        latest_question = asked[-1] if asked else ""
        is_experience_question = _is_experience_style_question(latest_question)

        should_follow_up = (
            not already_followed_up_for_this_question
            and not is_low_info_answer(latest_answer)
            and (is_experience_question or len(latest_answer.strip()) >= 40)
        )
        if should_follow_up:
            return "ask_follow_up"

    if plan and len(asked) >= len(plan.questions):
        return "request_human_review"

    return "ask_next_question"


def build_graph() -> StateGraph:
    workflow = StateGraph(InterviewState)

    workflow.add_node("parse_resume", parse_resume_node)
    workflow.add_node("parse_jd", parse_jd_node)
    workflow.add_node("audit_resume", audit_resume_node)
    workflow.add_node("researcher", researcher_node)
    workflow.add_node("build_gap_analysis", build_gap_analysis_node)
    workflow.add_node("build_interview_plan", build_interview_plan_node)
    workflow.add_node("ask_next_question", ask_next_question_node)
    workflow.add_node("ask_follow_up", ask_follow_up_node)
    workflow.add_node("ask_clarification", ask_clarification_node)
    workflow.add_node("evaluate_answer", evaluate_answer_node)
    workflow.add_node("request_human_review", request_human_review_node)
    workflow.add_node("finalize_report", finalize_report_node)

    workflow.add_conditional_edges(
        START,
        decide_start_entry,
        {
            "parse_resume": "parse_resume",
            "parse_jd": "parse_jd",
            "build_gap_analysis": "build_gap_analysis",
        },
    )
    workflow.add_conditional_edges(
        "parse_resume",
        decide_after_parse_resume,
        {
            "parse_jd": "parse_jd",
            "build_gap_analysis": "build_gap_analysis",
        },
    )
    workflow.add_conditional_edges(
        "parse_jd",
        decide_after_parse_jd,
        {
            "audit_resume": "audit_resume",
            "build_gap_analysis": "build_gap_analysis",
        },
    )
    workflow.add_conditional_edges(
        "audit_resume",
        decide_after_audit,
        {
            "researcher": "researcher",
            "build_gap_analysis": "build_gap_analysis",
        },
    )
    workflow.add_edge("researcher", "build_gap_analysis")
    workflow.add_edge("build_gap_analysis", "build_interview_plan")
    workflow.add_edge("build_interview_plan", "ask_next_question")
    workflow.add_edge("ask_next_question", "evaluate_answer")

    workflow.add_conditional_edges(
        "evaluate_answer",
        decide_next_step,
        {
            "ask_next_question": "ask_next_question",
            "ask_follow_up": "ask_follow_up",
            "ask_clarification": "ask_clarification",
            "request_human_review": "request_human_review",
        },
    )

    workflow.add_edge("ask_follow_up", "evaluate_answer")
    workflow.add_edge("ask_clarification", "evaluate_answer")
    workflow.add_edge("request_human_review", "finalize_report")
    workflow.add_edge("finalize_report", END)
    return workflow


def get_compiled_graph(checkpointer=None):
    builder = build_graph()
    if checkpointer is None:
        checkpointer = create_checkpointer()

    return builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["evaluate_answer"],
        interrupt_after=["request_human_review"],
    )
