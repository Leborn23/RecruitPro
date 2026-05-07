import os
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from src.agent.graph import _is_experience_style_question, get_compiled_graph
from src.agent.llm_service import default_llm
from src.agent.api_schemas import AgentActionType
from src.agent.runtime import InterviewAgentRuntime
from src.agent.nodes import reviewer
from src.agent.schemas import InterviewPlan


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


def test_evaluate_answer_falls_back_when_structured_llm_fails(monkeypatch):
    plan = InterviewPlan.model_validate(
        {
            "questions": [
                {
                    "topic": "architecture",
                    "question_text": "How would you design the module?",
                    "expected_key_points": ["interfaces", "tests"],
                    "rendered_text": "How would you design the module?",
                },
                {
                    "topic": "testing",
                    "question_text": "How would you test it?",
                    "expected_key_points": ["unit", "integration"],
                    "rendered_text": "How would you test it?",
                },
                {
                    "topic": "deployment",
                    "question_text": "How would you deploy it?",
                    "expected_key_points": ["rollback", "monitoring"],
                    "rendered_text": "How would you deploy it?",
                },
            ],
            "estimated_duration_minutes": 15,
        }
    )
    monkeypatch.setattr(
        reviewer.default_llm,
        "invoke_structured",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("invalid json")),
    )

    result = reviewer.evaluate_answer_node(
        {
            "interview_plan": plan,
            "asked_questions": ["How would you design the module?"],
            "answers": ["I would split interfaces, services, and tests."],
        }
    )

    evaluation = result["last_evaluation"]
    assert evaluation.dimensions.technical_depth == 4
    assert "llm_evaluation_failed_needs_review" in evaluation.missing_logic_elements


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


def test_decide_next_step_allows_followup_on_each_question():
    from src.agent.graph import decide_next_step
    from src.agent.schemas import AnswerEvaluation, ScoreDimensions

    state = {
        "interview_plan": SimpleNamespace(questions=[object(), object(), object()]),
        "asked_questions": [
            "Q1 项目经历：请介绍一个你负责的项目",
            "Q2 项目经历：请介绍另一个你负责的项目",
        ],
        "answers": [
            "A1 first answer with enough useful detail to be eligible for a follow-up.",
            "A1 follow-up answer.",
            "A2 first answer with enough useful detail to be eligible for a follow-up.",
        ],
        "last_evaluation": AnswerEvaluation(
            question="Q2 项目经历：请介绍另一个你负责的项目",
            answer="A2 first answer with enough useful detail to be eligible for a follow-up.",
            dimensions=ScoreDimensions(
                technical_depth=5,
                communication_logic=5,
                problem_solving=5,
            ),
            feedback="Missing implementation details.",
            missing_logic_elements=["implementation_details"],
        ),
        "followed_up_question_indexes": [0],
    }

    assert decide_next_step(state) == "ask_follow_up"


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
