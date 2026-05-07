from src.agent.nodes.interviewer import ask_follow_up_node
from src.agent.schemas import AnswerEvaluation, ScoreDimensions


def test_follow_up_records_current_question_index(monkeypatch):
    from src.agent.nodes import interviewer

    monkeypatch.setattr(
        interviewer.default_llm,
        "invoke_plain",
        lambda **kwargs: "Please explain the key tradeoff.",
    )

    result = ask_follow_up_node(
        {
            "asked_questions": ["Q1", "Q2"],
            "last_evaluation": AnswerEvaluation(
                question="Q2",
                answer="A2",
                dimensions=ScoreDimensions(
                    technical_depth=6,
                    communication_logic=5,
                    problem_solving=6,
                ),
                feedback="Missing detail.",
                missing_logic_elements=["tradeoff"],
            ),
        }
    )

    assert result["followed_up_question_indexes"] == [1]
