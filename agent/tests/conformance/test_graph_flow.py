import os

from src.agent.api_schemas import AgentActionType
from src.agent.llm_service import default_llm
from src.agent.runtime import InterviewAgentRuntime


def _force_mock_llm():
    os.environ["AGENT_MODE"] = "dev"
    os.environ["LLM_PROVIDER"] = "manual_openai"
    os.environ["API_KEY"] = ""
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["BASE_URL"] = ""
    os.environ["OPENAI_BASE_URL"] = ""
    default_llm.reset()


def test_graph_max_turns_enforcement():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_max_turns_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    for index in range(15):
        if response.status == AgentActionType.ASK:
            response = runtime.submit_answer(tid, f"My answer to question {index}")
        else:
            break

    assert response.status in {AgentActionType.WAIT_FOR_REVIEW, AgentActionType.FINISH}


def test_graph_human_review_interrupt():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_interrupt_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    for _ in range(20):
        if response.status == AgentActionType.ASK:
            response = runtime.submit_answer(tid, "Some answer")
        else:
            break

    assert response.status == AgentActionType.WAIT_FOR_REVIEW

    state = runtime.graph.get_state({"configurable": {"thread_id": tid}})
    assert state.values.get("review_decision") is None
    assert state.values.get("final_report") is None

    blocked_answer = runtime.submit_answer(tid, "One more answer after review is requested")
    state = runtime.graph.get_state({"configurable": {"thread_id": tid}})

    assert blocked_answer.status == AgentActionType.ERROR
    assert state.values.get("review_decision") is None
    assert state.values.get("final_report") is None

    response = runtime.submit_human_review(tid, approved=True, comments="Approved by HR")

    assert response.status == AgentActionType.FINISH
    assert response.final_report is not None


def test_answer_response_includes_latest_partial_evaluation():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_partial_eval_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    assert response.partial_eval is None

    answer_text = "I don't know"
    response = runtime.submit_answer(tid, answer_text)

    assert response.status == AgentActionType.ASK
    assert response.partial_eval is not None
    assert response.partial_eval.answer == answer_text


def test_human_review_before_review_stage_is_rejected():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_premature_review_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    assert response.status == AgentActionType.ASK

    review = runtime.submit_human_review(tid, approved=True, comments="Too early")
    state = runtime.graph.get_state({"configurable": {"thread_id": tid}})

    assert review.status == AgentActionType.ERROR
    assert state.values.get("review_decision") is None


def test_answer_after_finished_session_is_rejected():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_finished_answer_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    while response.status == AgentActionType.ASK:
        response = runtime.submit_answer(tid, "Some answer")

    assert response.status == AgentActionType.WAIT_FOR_REVIEW

    response = runtime.submit_human_review(tid, approved=True, comments="Approved by HR")
    assert response.status == AgentActionType.FINISH

    state_before = runtime.graph.get_state({"configurable": {"thread_id": tid}})
    answer_count_before = len(state_before.values.get("answers", []) or [])

    late_answer = runtime.submit_answer(tid, "Late answer")
    state_after = runtime.graph.get_state({"configurable": {"thread_id": tid}})

    assert late_answer.status == AgentActionType.ERROR
    assert len(state_after.values.get("answers", []) or []) == answer_count_before
    assert state_after.values.get("final_report") is not None


def test_rejected_human_review_requires_comments_without_crashing():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_review_comments_required_session"
    response = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)

    while response.status == AgentActionType.ASK:
        response = runtime.submit_answer(tid, "Some answer")

    assert response.status == AgentActionType.WAIT_FOR_REVIEW

    review = runtime.submit_human_review(tid, approved=False, comments="")
    state = runtime.graph.get_state({"configurable": {"thread_id": tid}})

    assert review.status == AgentActionType.ERROR
    assert "comments" in (review.message or "")
    assert state.values.get("review_decision") is None
    assert state.values.get("final_report") is None
