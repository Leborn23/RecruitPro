from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from .schemas import (
    CandidateProfile,
    JobProfile,
    GapAnalysis,
    InterviewPlan,
    AnswerEvaluation,
    FinalInterviewReport
)

class AgentActionType(str, Enum):
    # ASK: 继续向候选人提问
    # WAIT_FOR_REVIEW: 等待人工审批（人审节点）
    # FINISH: 整个面试流程已结束
    # ERROR: 异常态（目前主链路较少直接返回）
    ASK = "ask"
    WAIT_FOR_REVIEW = "wait_for_review"
    FINISH = "finish"
    ERROR = "error"

class AgentResponse(BaseModel):
    """ Standard output from Agent back to the Recruitment System """
    status: AgentActionType
    thread_id: str
    message: Optional[str] = Field(None, description="Conversational text for UI")
    
    # 分阶段可用的结构化数据：
    # - 面试早期：candidate_profile / job_profile
    # - 出题规划后：gap_analysis / interview_plan
    # - 逐题评估：partial_eval（视调用方式而定）
    # - 结束：final_report
    candidate_profile: Optional[CandidateProfile] = None
    job_profile: Optional[JobProfile] = None
    gap_analysis: Optional[GapAnalysis] = None
    interview_plan: Optional[InterviewPlan] = None
    partial_eval: Optional[AnswerEvaluation] = None
    final_report: Optional[FinalInterviewReport] = None
    
    # 给外部系统扩展字段（兼容未来扩展，避免频繁改主 schema）。
    metadata: Dict[str, Any] = Field(default_factory=dict)

class AgentInput(BaseModel):
    """ Standard input from recruitment system to the agent """
    # 统一输入容器，不同阶段按需填字段。
    # 例如：start 阶段给 resume/jd，答题阶段给 user_answer，人审阶段给 human_approval。
    resume_text: Optional[str] = None
    jd_text: Optional[str] = None
    user_answer: Optional[str] = None
    human_approval: Optional[bool] = None
    reviewer_comments: Optional[str] = None
