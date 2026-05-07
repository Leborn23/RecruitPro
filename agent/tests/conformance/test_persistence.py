import os

from langgraph.checkpoint.memory import MemorySaver

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


def test_session_recovery_with_thread_id():
    _force_mock_llm()
    memory = MemorySaver()
    runtime = InterviewAgentRuntime(checkpointer=memory)
    tid = "test_persistence_session"

    response = runtime.start_interview("Candidate A", "Python dev", thread_id=tid)
    first_question = response.message

    default_llm.reset()
    new_runtime = InterviewAgentRuntime(checkpointer=memory)
    status_response = new_runtime.get_session_status(tid)

    assert status_response.message == first_question
    assert status_response.status == AgentActionType.ASK
    assert status_response.thread_id == tid


def test_resume_after_human_review_persistence():
    _force_mock_llm()
    memory = MemorySaver()
    runtime = InterviewAgentRuntime(checkpointer=memory)
    tid = "test_resume_persistence_session"

    response = runtime.start_interview("Candidate B", "Python dev", thread_id=tid)

    for _ in range(15):
        if response.status == AgentActionType.ASK:
            response = runtime.submit_answer(tid, "Answer")
        else:
            break

    if response.status == AgentActionType.FINISH:
        assert response.final_report is not None
        return

    assert response.status == AgentActionType.WAIT_FOR_REVIEW

    default_llm.reset()
    new_runtime = InterviewAgentRuntime(checkpointer=memory)
    final_response = new_runtime.submit_human_review(tid, approved=True, comments="OK")

    assert final_response.status == AgentActionType.FINISH
    assert final_response.final_report is not None
