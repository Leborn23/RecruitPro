import os
from typing import Optional, Dict, Any
from .schemas import CandidateProfile, JobProfile
from .runtime import InterviewAgentRuntime
from .api_schemas import AgentResponse, AgentActionType

class RecruitmentIntegrationService:
    """ The Core Integration Layer.
        Recruitment portals (Django, Node, etc.) should only interact with this class.
        It encapsulates data mapping, thread ID resolution, and outcome synchronization.
    """

    def __init__(self, runtime: Optional[InterviewAgentRuntime] = None):
        # runtime 负责真正的图执行；integration_service 负责“业务系统接入层”语义。
        self.runtime = runtime or InterviewAgentRuntime()
        # Demo 里用内存 dict 映射；生产环境建议改成 DB 映射表（session_id <-> thread_id）。
        self._session_mapping: Dict[str, str] = {}

    def start_candidate_interview(
        self,
        session_id: str,
        resume_text: str,
        jd_text: str,
        candidate_profile: Optional[CandidateProfile] = None,
        job_profile: Optional[JobProfile] = None,
        question_count: Optional[int] = None,
    ) -> AgentResponse:
        """ 1. Host create session -> Agent start interview.
            Maps custom host ID to agent-side thread ID.
        """
        # 入口系统 session_id 与 agent thread_id 一一对应，方便排障与追踪。
        self._session_mapping[session_id] = session_id
        
        # Call the runtime
        return self.runtime.start_interview(
            resume_text,
            jd_text,
            thread_id=session_id,
            candidate_profile=candidate_profile,
            job_profile=job_profile,
            question_count=question_count,
        )

    def handle_user_interaction(self, session_id: str, user_answer_text: str) -> AgentResponse:
        """ 2. Submit candidate answer. 
            Bridge from the chat UI to the agent logic.
        """
        # 对接聊天输入：每次用户回复都会触发一次图继续执行。
        return self.runtime.submit_answer(session_id, user_answer_text)

    def finalize_by_hr(self, session_id: str, approved: bool, comments: str) -> AgentResponse:
        """ 3. HR Submit Decision -> Agent finalize and generate report.
            Resume graph flow after human-in-the-loop pause.
        """
        return self.runtime.submit_human_review(session_id, approved, comments)

    def get_interview_summary(self, session_id: str) -> Dict[str, Any]:
        """ 4. Sync final results to Host DB.
            Extracts hiring-relevant metrics from structured agent output.
        """
        response = self.runtime.get_session_status(session_id)
        # 只有 FINISH 且存在 final_report 时，才认为可同步最终结论。
        if response.status != AgentActionType.FINISH or not response.final_report:
            return {"ready": False, "status": response.status.value}
            
        report = response.final_report
        # 输出的是“集成侧摘要”，不是完整报告；用于业务系统快速展示。
        return {
            "ready": True,
            "overall_score": report.overall_score,
            "decision": report.hire_recommendation.value,
            "strengths": report.strengths,
            "weaknesses": report.weaknesses,
            "detailed_log_count": len(report.detailed_evaluations)
        }
