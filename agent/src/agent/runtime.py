import uuid
import warnings
from typing import Any, Dict, Optional

warnings.filterwarnings("ignore", message="Deserializing unregistered type")

from .checkpoint_compat import register_msgpack_allowed_types
from .checkpoint_factory import create_checkpointer
from .concurrency import SessionLockManager
from .graph import get_compiled_graph
from .interview_config import interview_question_count_override
from .api_schemas import AgentActionType, AgentResponse
from .schemas import CandidateProfile, HireRecommendation, HumanReviewDecision, JobProfile
from .langsmith_utils import (
    build_langsmith_extra,
    call_with_langsmith_extra,
    interview_tracing_context,
    traceable,
)

register_msgpack_allowed_types()


class InterviewAgentRuntime:
    """Host-to-agent runtime for interview sessions."""

    def __init__(self, checkpointer=None, session_locks: Optional[SessionLockManager] = None):
        self.graph = get_compiled_graph(checkpointer=checkpointer or create_checkpointer())
        self.session_locks = session_locks or SessionLockManager()

    def start_interview(
        self,
        resume_text: str,
        jd_text: str,
        thread_id: Optional[str] = None,
        candidate_profile: Optional[CandidateProfile] = None,
        job_profile: Optional[JobProfile] = None,
        question_count: Optional[int] = None,
    ) -> AgentResponse:
        tid = thread_id or str(uuid.uuid4())

        from .state import StopReason

        initial_input = {
            "messages": [],
            "resume_text": resume_text,
            "jd_text": jd_text,
            "candidate_profile": candidate_profile,
            "job_profile": job_profile,
            "gap_analysis": None,
            "interview_plan": None,
            "asked_questions": [],
            "answers": [],
            "partial_scores": [],
            "final_report": None,
            "review_decision": None,
            "stop_reason": StopReason.NOT_STOPPED,
            "checkpoint_metadata": {"thread_id": tid, "session_id": tid},
        }

        with self.session_locks.locked(tid):
            if self._session_exists(tid):
                return self._error_response(tid, "Session already exists. Use the existing session id or create a new one.")
            with interview_question_count_override(question_count):
                return call_with_langsmith_extra(
                    self._run_and_parse,
                    tid,
                    initial_input,
                    session_id=tid,
                    langsmith_extra=build_langsmith_extra(
                        thread_id=tid,
                        session_id=tid,
                        run_name="runtime.start_interview",
                        tags=["runtime", "interview"],
                    ),
                )

    def submit_answer(self, thread_id: str, user_answer: str) -> AgentResponse:
        config = {"configurable": {"thread_id": thread_id}}

        with self.session_locks.locked(thread_id):
            if not self._session_exists(thread_id):
                return self._error_response(thread_id, "Session not found. Start the interview before submitting answers.")
            if self._is_waiting_for_review(thread_id):
                return self._error_response(thread_id, "Session is waiting for human review. Submit a review decision next.")
            if not self._is_waiting_for_answer(thread_id):
                return self._error_response(thread_id, "Session is not waiting for a candidate answer.")
            if not self._has_pending_answer_for_current_question(thread_id):
                self.graph.update_state(
                    config,
                    {
                        "answers": [user_answer],
                        "checkpoint_metadata": {"thread_id": thread_id, "session_id": thread_id},
                    },
                )
            return call_with_langsmith_extra(
                self._run_and_parse,
                thread_id,
                None,
                session_id=thread_id,
                langsmith_extra=build_langsmith_extra(
                    thread_id=thread_id,
                    session_id=thread_id,
                    run_name="runtime.submit_answer",
                    tags=["runtime", "interview"],
                ),
            )

    def submit_human_review(self, thread_id: str, approved: bool, comments: str = "") -> AgentResponse:
        config = {"configurable": {"thread_id": thread_id}}

        with self.session_locks.locked(thread_id):
            if not self._session_exists(thread_id):
                return self._error_response(thread_id, "Session not found. Start the interview before submitting review.")
            if not self._is_waiting_for_review(thread_id):
                return self._error_response(thread_id, "Session is not waiting for human review.")
            if not approved and not comments.strip():
                return self._error_response(thread_id, "Rejected human review requires reviewer comments.")
            decision = HumanReviewDecision(
                approved=approved,
                reviewer_comments=comments,
                adjusted_recommendation=HireRecommendation.HIRE if approved else HireRecommendation.NO_HIRE,
            )
            self.graph.update_state(
                config,
                {
                    "review_decision": decision,
                    "checkpoint_metadata": {"thread_id": thread_id, "session_id": thread_id},
                },
            )
            return call_with_langsmith_extra(
                self._run_and_parse,
                thread_id,
                None,
                session_id=thread_id,
                langsmith_extra=build_langsmith_extra(
                    thread_id=thread_id,
                    session_id=thread_id,
                    run_name="runtime.submit_human_review",
                    tags=["runtime", "interview"],
                ),
            )

    def get_session_status(self, thread_id: str) -> AgentResponse:
        with self.session_locks.locked(thread_id):
            return call_with_langsmith_extra(
                self._parse_state_to_response,
                thread_id,
                langsmith_extra=build_langsmith_extra(
                    thread_id=thread_id,
                    session_id=thread_id,
                    run_name="runtime.get_session_status",
                    tags=["runtime", "status"],
                ),
            )

    @traceable(name="runtime.run_and_parse", run_type="chain")
    def _run_and_parse(
        self, thread_id: str, input_val: Optional[Dict[str, Any]], session_id: Optional[str] = None
    ) -> AgentResponse:
        config = {"configurable": {"thread_id": thread_id}}
        with interview_tracing_context(
            thread_id=thread_id,
            session_id=session_id or thread_id,
            tags=["langgraph", "interview"],
        ):
            for _event in self.graph.stream(input_val, config):
                pass
            return self._parse_state_to_response(thread_id)

    @traceable(name="runtime.parse_state_to_response", run_type="chain")
    def _parse_state_to_response(self, thread_id: str) -> AgentResponse:
        config = {"configurable": {"thread_id": thread_id}}
        state = self.graph.get_state(config)
        vals = state.values
        next_nodes = state.next

        if not vals:
            return self._error_response(thread_id, "Session not found.")

        status = AgentActionType.ASK
        if not next_nodes:
            status = AgentActionType.FINISH
        elif "request_human_review" in next_nodes or ("finalize_report" in next_nodes and not vals.get("review_decision")):
            status = AgentActionType.WAIT_FOR_REVIEW

        messages = vals.get("messages", [])
        last_msg = messages[-1].content if messages else None

        return AgentResponse(
            status=status,
            thread_id=thread_id,
            message=last_msg,
            candidate_profile=vals.get("candidate_profile"),
            job_profile=vals.get("job_profile"),
            gap_analysis=vals.get("gap_analysis"),
            interview_plan=vals.get("interview_plan"),
            partial_eval=vals.get("last_evaluation"),
            final_report=vals.get("final_report"),
        )

    def _session_exists(self, thread_id: str) -> bool:
        state = self.graph.get_state({"configurable": {"thread_id": thread_id}})
        return bool(state.values)

    def _is_waiting_for_review(self, thread_id: str) -> bool:
        state = self.graph.get_state({"configurable": {"thread_id": thread_id}})
        next_nodes = state.next or ()
        return (
            ("request_human_review" in next_nodes or "finalize_report" in next_nodes)
            and not state.values.get("review_decision")
        )

    def _is_waiting_for_answer(self, thread_id: str) -> bool:
        state = self.graph.get_state({"configurable": {"thread_id": thread_id}})
        return "evaluate_answer" in (state.next or ())

    def _has_pending_answer_for_current_question(self, thread_id: str) -> bool:
        state = self.graph.get_state({"configurable": {"thread_id": thread_id}})
        vals = state.values or {}
        asked_questions = vals.get("asked_questions") or []
        answers = vals.get("answers") or []
        messages = vals.get("messages") or []

        last_ai_index = -1
        last_human_index = -1
        for index, message in enumerate(messages):
            message_type = str(getattr(message, "type", "") or "").lower()
            if message_type == "ai":
                last_ai_index = index
            elif message_type == "human":
                last_human_index = index

        if last_ai_index >= 0:
            return last_human_index > last_ai_index

        return len(answers) >= len(asked_questions) and len(asked_questions) > 0

    def _error_response(self, thread_id: str, message: str) -> AgentResponse:
        return AgentResponse(
            status=AgentActionType.ERROR,
            thread_id=thread_id,
            message=message,
            metadata={"error": message},
        )

    def close(self) -> None:
        owned_conn = getattr(self.graph.checkpointer, "_owned_sqlite_conn", None)
        if owned_conn is not None:
            owned_conn.close()
