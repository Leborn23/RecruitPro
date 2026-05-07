"""
Parser Node Module (Phase 3)
Responsibility: Dedicated nodes for resume and jd structured parsing.
"""
from typing import Dict, Any
from src.agent.state import InterviewState
from src.agent.schemas import CandidateProfile, JobProfile
from src.agent.llm_service import default_llm
from src.agent.prompts.parser_prompts import RESUME_PARSE_PROMPT, JD_PARSE_PROMPT
from src.agent.langsmith_utils import traceable

@traceable(name="node.parse_resume", run_type="chain")
def parse_resume_node(state: InterviewState) -> Dict[str, Any]:
    """ Node 1: parse_resume """
    # 这里保留原始文本到结构化 profile 的单一职责，便于排查抽取质量。
    text = state.get("resume_text", "No resume provided.")
    profile = default_llm.invoke_structured(
        system_prompt=RESUME_PARSE_PROMPT,
        user_prompt=f"Resume Text:\n{text}",
        schema=CandidateProfile
    )
    return {"candidate_profile": profile}

@traceable(name="node.parse_jd", run_type="chain")
def parse_jd_node(state: InterviewState) -> Dict[str, Any]:
    """ Node 2: parse_jd """
    # JD 结构化输出是后续 gap 分析和题目规划的输入基线。
    text = state.get("jd_text", "No JD provided.")
    profile = default_llm.invoke_structured(
        system_prompt=JD_PARSE_PROMPT,
        user_prompt=f"Job Description Text:\n{text}",
        schema=JobProfile
    )
    return {"job_profile": profile}
