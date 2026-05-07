import os
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from src.agent.graph import _is_experience_style_question, get_compiled_graph
from src.agent.llm_service import default_llm
from src.agent.api_schemas import AgentActionType
from src.agent.runtime import InterviewAgentRuntime


def _force_mock_llm():
    os.environ["AGENT_MODE"] = "dev"
    os.environ["LLM_PROVIDER"] = "manual_openai"
    os.environ["API_KEY"] = ""
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["BASE_URL"] = ""
    os.environ["OPENAI_BASE_URL"] = ""
    default_llm.reset()


def test_graph_initialization():
    graph = get_compiled_graph()
    assert graph is not None


def test_experience_style_question_detects_chinese_keywords():
    assert _is_experience_style_question("请讲一个你负责的项目经历")


def test_runtime_reports_error_for_unknown_session():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()

    status = runtime.get_session_status("unknown-session")
    answer = runtime.submit_answer("unknown-session", "hello")
    review = runtime.submit_human_review("unknown-session", approved=True, comments="ok")
    rejected_review = runtime.submit_human_review("unknown-session", approved=False, comments="")

    assert status.status == AgentActionType.ERROR
    assert answer.status == AgentActionType.ERROR
    assert review.status == AgentActionType.ERROR
    assert rejected_review.status == AgentActionType.ERROR


def test_runtime_rejects_duplicate_start_for_existing_session():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "duplicate-start-session"

    first = runtime.start_interview("Python dev", "Need Python dev", thread_id=tid)
    second = runtime.start_interview("Different candidate", "Different job", thread_id=tid)
    state = runtime.graph.get_state({"configurable": {"thread_id": tid}})

    assert first.status == AgentActionType.ASK
    assert second.status == AgentActionType.ERROR
    assert state.values.get("resume_text") == "Python dev"
    assert state.values.get("jd_text") == "Need Python dev"
    assert len(state.values.get("asked_questions", []) or []) == 1


def test_runtime_detects_followup_still_waits_for_answer():
    runtime = InterviewAgentRuntime.__new__(InterviewAgentRuntime)
    runtime.graph = SimpleNamespace(
        get_state=lambda _config: SimpleNamespace(
            values={
                "asked_questions": ["main question"],
                "answers": ["main answer"],
                "messages": [
                    AIMessage(content="main question"),
                    HumanMessage(content="main answer"),
                    AIMessage(content="follow-up question"),
                ],
            }
        )
    )

    assert runtime._has_pending_answer_for_current_question("followup-session") is False


def test_graph_execution_mock():
    _force_mock_llm()
    graph = get_compiled_graph(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "test_modular_1"}}

    initial_state = {
        "messages": [],
        "resume_text": "Mock Resume",
        "jd_text": "Mock JD",
        "asked_questions": [],
        "answers": [],
        "partial_scores": [],
    }

    for _event in graph.stream(initial_state, config):
        pass

    state = graph.get_state(config)
    assert state.next == ("evaluate_answer",)
    assert state.values["candidate_profile"].name == "Alice Candidate"
    assert len(state.values["asked_questions"]) == 1

    graph.update_state(config, {"answers": ["Mock User Answer"]})
    for _event in graph.stream(None, config):
        pass

    state = graph.get_state(config)
    assert state.next == ("evaluate_answer",)
    assert len(state.values["asked_questions"]) >= 2
