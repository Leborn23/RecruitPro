"""
State Module
Responsibility: Defining the central LangGraph TypedDict representing the Agent's brain.
"""
from typing import TypedDict, Annotated, List, Optional, Dict, Any
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage
from enum import Enum

import operator
from .schemas import (
    CandidateProfile,
    JobProfile,
    GapAnalysis,
    InterviewPlan,
    AnswerEvaluation,
    AuditResult,
    FinalInterviewReport,
    HumanReviewDecision
)

def append_reducer(left: list, right: list) -> list:
    """ Robust reducer for appending to lists in LangGraph. """
    # LangGraph 在并行/多轮更新时会走 reducer，这里统一做空值保护。
    if left is None: left = []
    if right is None: right = []
    return left + right

class StopReason(str, Enum):
    NOT_STOPPED = "not_stopped"
    HUMAN_INTERVENTION_REQUIRED = "human_intervention_required"
    CANDIDATE_WITHDREW = "candidate_withdrew"
    FINISHED_SUCCESSFULLY = "finished_successfully"
    ERROR = "error"

class InterviewState(TypedDict):
    """
    State definition for the Recruitment Interview Agent.
    Strictly follows the project rules for required state variables.
    """
    
    # 核心对话历史：用于展示和上下文串联（不是长期记忆库）。
    messages: Annotated[list[BaseMessage], add_messages]
    
    # 原始输入：简历/JD 文本会在多个节点复用。
    resume_text: str
    jd_text: str
    
    # Phase 2: Schema objects representing typed state
    candidate_profile: Optional[CandidateProfile]
    job_profile: Optional[JobProfile]
    
    gap_analysis: Optional[GapAnalysis]
    interview_plan: Optional[InterviewPlan]
    
    # 面试执行轨迹：题目、回答、评分都会持续追加。
    asked_questions: Annotated[List[str], append_reducer]
    answers: Annotated[List[str], append_reducer]
    partial_scores: Annotated[List[AnswerEvaluation], append_reducer]
    followed_up_question_indexes: Annotated[List[int], append_reducer]
    
    # 最新评估：路由器 decide_next_step 的主要依据。
    last_evaluation: Optional[AnswerEvaluation]
    
    # [NEW] Audit & Risk results
    audit_result: Optional[AuditResult]
    
    # [NEW] Research intelligence from external search
    research_notes: Annotated[List[str], append_reducer]
    
    # Outcomes & Reviews
    final_report: Optional[FinalInterviewReport]
    review_decision: Optional[HumanReviewDecision]
    stop_reason: StopReason
    
    # 元数据：用于 thread/session 关联和 checkpoint 辅助信息。
    checkpoint_metadata: Dict[str, Any]
