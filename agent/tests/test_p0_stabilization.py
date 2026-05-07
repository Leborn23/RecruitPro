from src.agent.graph import decide_next_step
from src.agent.schemas import InterviewPlan, InterviewQuestion


def test_schema_bounded_length():
    questions = [
        InterviewQuestion(topic="T", question_text="Q", expected_key_points=["K"])
        for _ in range(6)
    ]
    plan = InterviewPlan(questions=questions, estimated_duration_minutes=30)
    assert len(plan.questions) == 5


def test_graph_fusing_loop_protection():
    mock_state = {"asked_questions": ["q"] * 15, "interview_plan": None, "answers": []}
    next_node = decide_next_step(mock_state)
    assert next_node == "request_human_review"
