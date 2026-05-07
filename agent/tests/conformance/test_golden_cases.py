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


def test_expert_rag_case_consistency():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_golden_expert_rag"

    case_dir = os.path.join("data", "cases", "expert_rag")
    files = os.listdir(case_dir)
    resume_file = next((f for f in files if "resume" in f.lower()), None)
    jd_file = next((f for f in files if "jd" in f.lower() or "case_data" in f.lower()), "jd.txt")

    if resume_file:
        with open(os.path.join(case_dir, resume_file), "r", encoding="utf-8") as handle:
            resume = handle.read()
    else:
        resume = "Default resume content"

    with open(os.path.join(case_dir, jd_file), "r", encoding="utf-8") as handle:
        jd = handle.read()

    response = runtime.start_interview(resume, jd, thread_id=tid)
    assert response.gap_analysis is not None
    assert response.gap_analysis.overall_fit_score >= 70


def test_risk_inconsistent_case_consistency():
    _force_mock_llm()
    runtime = InterviewAgentRuntime()
    tid = "test_golden_risk_inconsistent"

    case_dir = os.path.join("data", "cases", "risk_inconsistent")
    with open(os.path.join(case_dir, "case_data.txt"), "r", encoding="utf-8") as handle:
        content = handle.read()
    parts = content.split("---")
    jd = parts[0]
    resume = parts[1] if len(parts) > 1 else content

    response = runtime.start_interview(resume, jd, thread_id=tid)
    assert response.status == AgentActionType.ASK
