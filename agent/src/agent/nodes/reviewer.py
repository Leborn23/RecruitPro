"""
Reviewer Node Module (Phase 3)
Responsibility: evaluate answers, human review breakpoint, report generation.
"""

import json
import logging
from typing import Any, Dict

from src.agent.state import InterviewState, StopReason
from src.agent.schemas import AnswerEvaluation, FinalInterviewReport
from src.agent.llm_service import default_llm
from src.agent.prompts.reviewer_prompts import EVALUATE_ANSWER_PROMPT, FINAL_REPORT_PROMPT
from src.agent.langsmith_utils import traceable
from src.agent.signal_utils import is_cannot_answer_signal, is_fixed_clarification_request


logger = logging.getLogger(__name__)


def _is_experience_question(question: str) -> bool:
    q = (question or "").lower()
    markers = [
        "\u9879\u76ee",
        "\u7ecf\u5386",
        "\u573a\u666f",
        "\u60c5\u5883",
        "\u4efb\u52a1",
        "\u884c\u52a8",
        "\u7ed3\u679c",
        "\u6848\u4f8b",
        "\u8d1f\u8d23",
        "star",
    ]
    return any(m in q for m in markers)


@traceable(name="node.evaluate_answer", run_type="chain")
def evaluate_answer_node(state: InterviewState) -> Dict[str, Any]:
    """Node 6: evaluate_answer."""
    asked = state.get("asked_questions", [])
    answers = state.get("answers", [])
    plan = state.get("interview_plan")

    if not asked or not answers or not plan:
        return {}

    last_q_text = asked[-1]
    last_a_text = answers[-1]

    idx = len(asked) - 1
    expected_pts = plan.questions[idx].expected_key_points if idx < len(plan.questions) else []

    topic = plan.questions[idx].topic if idx < len(plan.questions) else "Unknown"
    logger.info("Evaluating answer %s for topic=%s.", len(answers), topic)

    # 通过 answers-asked 判断当前题是否已经发生过额外轮次（追问/澄清）。
    extra_rounds_used = max(0, len(answers) - len(asked))

    # Only fixed sentence gets one non-scored clarification chance.
    # 固定句首次出现：允许一次澄清，不计入正式评分。
    if is_fixed_clarification_request(last_a_text) and extra_rounds_used == 0:
        clarification_eval = AnswerEvaluation.model_validate(
            {
                "question": last_q_text,
                "answer": last_a_text,
                "dimensions": {
                    "technical_depth": 0,
                    "communication_logic": 0,
                    "problem_solving": 0,
                },
                "feedback": "候选人反馈当前问题理解或作答受阻，进入澄清轮，不计入正式评分。",
                "missing_logic_elements": ["clarification_needed"],
            }
        )
        return {"last_evaluation": clarification_eval}

    # 再次要求澄清：视为无法作答，低分计入并换方向。
    if is_fixed_clarification_request(last_a_text) and extra_rounds_used > 0:
        repeated_clarify_eval = AnswerEvaluation.model_validate(
            {
                "question": last_q_text,
                "answer": last_a_text,
                "dimensions": {
                    "technical_depth": 1,
                    "communication_logic": 1,
                    "problem_solving": 1,
                },
                "feedback": "已提供一次详细重述，仍未进入有效作答。本题按低分计入，并切换到其他方向继续评估。",
                "missing_logic_elements": ["cannot_answer_switch_direction"],
            }
        )
        return {"partial_scores": [repeated_clarify_eval], "last_evaluation": repeated_clarify_eval}

    # "Cannot answer" signals are scored low and counted.
    # “不会类”回答直接低分计入，保证评分有区分度且流程继续推进。
    if is_cannot_answer_signal(last_a_text):
        cannot_eval = AnswerEvaluation.model_validate(
            {
                "question": last_q_text,
                "answer": last_a_text,
                "dimensions": {
                    "technical_depth": 1,
                    "communication_logic": 1,
                    "problem_solving": 1,
                },
                "feedback": "候选人明确表示不会/不清楚，未提供可评估技术内容。本题按低分计入，并切换到其他方向继续评估。",
                "missing_logic_elements": ["cannot_answer_switch_direction"],
            }
        )
        return {"partial_scores": [cannot_eval], "last_evaluation": cannot_eval}

    question_type = (
        "\u9879\u76ee/\u7ecf\u5386\u9898"
        if _is_experience_question(last_q_text)
        else "\u6280\u672f\u6982\u5ff5/\u7b97\u6cd5/\u8c03\u8bd5\u9898"
    )

    sys_p = EVALUATE_ANSWER_PROMPT.format(
        question_type=question_type,
        question_text=last_q_text,
        expected_key_points=", ".join(expected_pts),
        candidate_answer=last_a_text,
    )

    try:
        eval_result = default_llm.invoke_structured(
            sys_p,
            "Analyze the answer and return strict JSON evaluation.",
            AnswerEvaluation,
        )
    except Exception:
        logger.exception("Answer evaluation LLM call failed. Falling back to conservative local evaluation.")
        eval_result = AnswerEvaluation.model_validate(
            {
                "question": last_q_text,
                "answer": last_a_text,
                "dimensions": {
                    "technical_depth": 4,
                    "communication_logic": 4,
                    "problem_solving": 4,
                },
                "feedback": "自动评价服务本轮返回异常，系统已按保守分记录并继续面试，建议最终报告中人工复核本题。",
                "missing_logic_elements": ["llm_evaluation_failed_needs_review"],
            }
        )

    return {
        "partial_scores": [eval_result],
        "last_evaluation": eval_result,
    }


def request_human_review_node(state: InterviewState) -> Dict[str, Any]:
    """Node 8: request_human_review."""
    return {}


@traceable(name="node.finalize_report", run_type="chain")
def finalize_report_node(state: InterviewState) -> Dict[str, Any]:
    """Node 9: finalize_report."""
    name = state.get("candidate_profile").name if state.get("candidate_profile") else "Unknown"
    job = state.get("job_profile")
    gap = state.get("gap_analysis")
    scores = state.get("partial_scores", [])
    decision = state.get("review_decision")

    # 总分按固定权重汇总，避免最终报告与逐题评分口径不一致。
    if scores:
        avg_tech = sum(s.dimensions.technical_depth for s in scores) / len(scores)
        avg_logic = sum(s.dimensions.communication_logic for s in scores) / len(scores)
        avg_prob = sum(s.dimensions.problem_solving for s in scores) / len(scores)
        weighted_score = int((avg_tech * 5) + (avg_logic * 3) + (avg_prob * 2))
    else:
        weighted_score = 0

    logger.info("Finalizing report with weighted_score=%s.", weighted_score)

    sys_p = FINAL_REPORT_PROMPT.format(
        candidate_name=name,
        weighted_score_input=weighted_score,
        job_profile_json=job.model_dump_json() if job else "",
        gap_analysis_json=gap.model_dump_json() if gap else "",
        evaluations_json=json.dumps([s.model_dump() for s in scores]),
        human_decision_json=decision.model_dump_json() if decision else "No manual override.",
    )

    report = default_llm.invoke_structured(sys_p, "Consolidate and emit final report.", FinalInterviewReport)
    report.overall_score = weighted_score

    return {
        "final_report": report,
        "stop_reason": StopReason.FINISHED_SUCCESSFULLY,
    }
