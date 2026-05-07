from src.agent.api_schemas import AgentActionType, AgentResponse
from src.showcase.app import infer_status_from_next, stage_from_state, st, submit_candidate_answer, submit_hr_review


def test_showcase_treats_finalize_report_next_node_as_human_review_wait():
    assert infer_status_from_next(("finalize_report",)) == "wait_for_review"
    assert stage_from_state(("finalize_report",), {"review_decision": None}) == "Pending HR Review"


class _ErrorRuntime:
    def submit_answer(self, thread_id: str, user_answer: str) -> AgentResponse:
        return AgentResponse(status=AgentActionType.ERROR, thread_id=thread_id, message="answer rejected")

    def submit_human_review(self, thread_id: str, approved: bool, comments: str) -> AgentResponse:
        return AgentResponse(status=AgentActionType.ERROR, thread_id=thread_id, message="review rejected")


def test_showcase_submit_helpers_surface_runtime_error_response():
    st.session_state.runtime = _ErrorRuntime()
    st.session_state.sessions = {"thread-1": {"updated_at": "before"}}

    assert submit_candidate_answer("thread-1", "answer") == "answer rejected"
    assert submit_hr_review("thread-1", True, "ok") == "review rejected"
    assert st.session_state.sessions["thread-1"]["updated_at"] == "before"
