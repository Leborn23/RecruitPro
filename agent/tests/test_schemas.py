import pytest
from pydantic import ValidationError

from src.agent.schemas import (
    AnswerEvaluation,
    EvidenceItem,
    FinalInterviewReport,
    GapAnalysis,
    HireRecommendation,
    HumanReviewDecision,
    JobProfile,
    ScoreDimensions,
    validate_llm_json,
)


def test_job_profile_validation():
    profile = JobProfile(
        title="Agent Developer",
        required_skills=["Python"],
        experience_years=3.5,
        key_responsibilities=["Code"],
    )
    assert profile.title == "Agent Developer"

    empty_skills = JobProfile(
        title="Dev",
        required_skills=[],
        experience_years=1,
        key_responsibilities=["Code"],
    )
    assert empty_skills.required_skills == []


def test_gap_analysis_validation():
    with pytest.raises(ValidationError):
        GapAnalysis(
            matching_skills=["Python"],
            missing_skills=[],
            experience_gap_years=0,
            overall_fit_score=150,
            focus_areas=["Pydantic"],
        )


def test_human_review_decision():
    decision = HumanReviewDecision(approved=True, reviewer_comments="Looks good to me.")
    assert decision.approved

    with pytest.raises(ValidationError):
        HumanReviewDecision(approved=False, reviewer_comments="")


def test_validate_llm_json_helper():
    mock_json = {
        "title": "Data Scientist",
        "required_skills": ["SQL", "Python"],
        "experience_years": 2,
        "key_responsibilities": ["Analyze data"],
    }
    profile = validate_llm_json(mock_json, JobProfile)
    assert isinstance(profile, JobProfile)
    assert profile.experience_years == 2.0

    bad_json = {"required_skills": ["SQL"]}
    with pytest.raises(ValueError, match="Schema Validation Failed"):
        validate_llm_json(bad_json, JobProfile)


def test_schema_serialization_examples():
    report = FinalInterviewReport(
        candidate_name="Bob",
        overall_score=85,
        strengths=[EvidenceItem(claim="Python", source_question_index=0)],
        weaknesses=[EvidenceItem(claim="GCP", source_question_index=0)],
        hire_recommendation=HireRecommendation.HIRE,
        detailed_evaluations=[
            AnswerEvaluation(
                question="What is GCP?",
                answer="No idea",
                dimensions=ScoreDimensions(
                    technical_depth=2,
                    communication_logic=3,
                    problem_solving=2,
                ),
                feedback="Did not know GCP.",
            )
        ],
    )
    dumped = report.model_dump()
    assert dumped["overall_score"] == 85
    assert len(dumped["detailed_evaluations"]) == 1
