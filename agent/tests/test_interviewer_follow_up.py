from src.agent.nodes.interviewer import FOLLOW_UP_PREFIX, ask_follow_up_node
from src.agent.schemas import AnswerEvaluation, ScoreDimensions


def test_follow_up_message_has_prefix(monkeypatch):
    from src.agent.nodes import interviewer

    monkeypatch.setattr(
        interviewer.default_llm,
        "invoke_plain",
        lambda **kwargs: "请具体说明你是如何验证这个方案效果的？",
    )

    result = ask_follow_up_node(
        {
            "last_evaluation": AnswerEvaluation(
                question="你是怎么做性能优化的？",
                answer="我做了优化。",
                dimensions=ScoreDimensions(
                    technical_depth=6,
                    communication_logic=5,
                    problem_solving=6,
                ),
                feedback="信息不足。",
                missing_logic_elements=["verification"],
            )
        }
    )

    message = result["messages"][0].content
    assert message.startswith(FOLLOW_UP_PREFIX)


def test_follow_up_message_does_not_duplicate_prefix(monkeypatch):
    from src.agent.nodes import interviewer

    monkeypatch.setattr(
        interviewer.default_llm,
        "invoke_plain",
        lambda **kwargs: "（追问） 请展开说明关键取舍。",
    )

    result = ask_follow_up_node(
        {
            "last_evaluation": AnswerEvaluation(
                question="为什么这么设计？",
                answer="因为这样更好。",
                dimensions=ScoreDimensions(
                    technical_depth=6,
                    communication_logic=5,
                    problem_solving=6,
                ),
                feedback="信息不足。",
                missing_logic_elements=["tradeoff"],
            )
        }
    )

    message = result["messages"][0].content
    assert message == "（追问） 请展开说明关键取舍。"
