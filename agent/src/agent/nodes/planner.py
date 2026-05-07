"""Planner node module."""

import logging
import math
from typing import Any, Dict

from src.agent.langsmith_utils import traceable
from src.agent.llm_service import default_llm
from src.agent.prompts.planner_prompts import GAP_ANALYSIS_PROMPT, format_interview_plan_prompt
from src.agent.schemas import GapAnalysis, InterviewPlan
from src.agent.state import InterviewState


logger = logging.getLogger(__name__)


@traceable(name="node.build_gap_analysis", run_type="chain")
def build_gap_analysis_node(state: InterviewState) -> Dict[str, Any]:
    """Build structured gap analysis from parsed JD and candidate profile."""
    jd = state.get("job_profile")
    candidate = state.get("candidate_profile")
    if not jd or not candidate:
        return {}

    # 输入统一走结构化 JSON，减少模型“想当然”编造。
    sys_p = GAP_ANALYSIS_PROMPT.format(
        job_profile_json=jd.model_dump_json(),
        candidate_profile_json=candidate.model_dump_json(),
    )
    gap_analysis = default_llm.invoke_structured(
        sys_p,
        "Begin gap analysis based on profiles.",
        GapAnalysis,
    )
    return {"gap_analysis": gap_analysis}


@traceable(name="node.build_interview_plan", run_type="chain")
def build_interview_plan_node(state: InterviewState) -> Dict[str, Any]:
    """Build interview plan with difficulty adaptation and resume anchors."""
    gap = state.get("gap_analysis")
    candidate = state.get("candidate_profile")
    if not gap:
        return {}

    # 经验年限用于难度分层，但做了容错，避免脏值导致崩溃。
    exp_years = candidate.experience_years if candidate else 0
    if not isinstance(exp_years, (int, float)) or not math.isfinite(float(exp_years)):
        exp_years = 0

    # 简历锚点用于“首题贴简历事实”，减少泛化模板题。
    anchors_list = candidate.key_achievements if candidate and candidate.key_achievements else []
    anchor_count = len(anchors_list)
    anchors = "\n".join([f"- {a}" for a in anchors_list]) if anchors_list else "[]"

    if exp_years >= 8:
        difficulty_level = "EXPERT"
        difficulty_instruction = (
            "Focus on architecture trade-offs, distributed reliability, constraints, and leadership decisions. "
            "Avoid basic syntax or textbook-only prompts."
        )
    elif exp_years >= 4:
        difficulty_level = "INTERMEDIATE"
        difficulty_instruction = (
            "Balance implementation details and moderate system design. "
            "Include at least one scenario requiring trade-off reasoning."
        )
    elif exp_years <= 0 and anchor_count > 0:
        difficulty_level = "INTERMEDIATE"
        difficulty_instruction = (
            "Years are unclear, but resume has project evidence. "
            "Ask practical implementation and project execution questions; avoid over-basic questions."
        )
    else:
        difficulty_level = "JUNIOR"
        difficulty_instruction = (
            "Focus on fundamentals, practical coding habits, and beginner-level problem solving. "
            "Still require concrete examples and clear reasoning."
        )

    logger.info(
        "Planning interview with difficulty=%s, experience_years=%s, anchor_count=%s.",
        difficulty_level,
        exp_years,
        anchor_count,
    )

    # 规划阶段一次性生成 3-5 题，运行阶段尽量不再临时造题。
    sys_p = format_interview_plan_prompt(
        gap_analysis_json=gap.model_dump_json(),
        difficulty_level=difficulty_level,
        difficulty_instruction=difficulty_instruction,
        candidate_profile_json=candidate.model_dump_json() if candidate else "{}",
        candidate_anchors=anchors,
        anchor_count=anchor_count,
    )
    plan = default_llm.invoke_structured(sys_p, "Formulate the interview plan.", InterviewPlan)
    return {"interview_plan": plan}
