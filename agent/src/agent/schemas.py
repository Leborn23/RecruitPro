"""
Schemas Module
Responsibility: Centralized Pydantic models acting as the contract for LLM
Structured Outputs, state properties, and external validations.
"""

import logging
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from src.agent.interview_config import get_interview_question_config


logger = logging.getLogger(__name__)


class JobProfile(BaseModel):
    title: str = Field(description="The formal job title from the JD.")
    required_skills: List[str] = Field(
        default_factory=list,
        description="List of required technical and soft skills extracted from the JD.",
    )
    experience_years: float = Field(default=0.0, ge=0, description="Minimum years of experience required.")
    key_responsibilities: List[str] = Field(
        default_factory=list,
        description="Main duties extracted from the JD.",
    )

    @field_validator("required_skills", "key_responsibilities")
    @classmethod
    def normalize_list(cls, value: List[str]) -> List[str]:
        if not value:
            return []
        return [item.strip() for item in value if item.strip()]


class CandidateProfile(BaseModel):
    name: str = Field(description="Candidate's name parsed from the resume.")
    skills: List[str] = Field(default_factory=list, description="List of skills possessed by the candidate.")
    experience_years: float = Field(default=0.0, ge=0, description="Calculated years of valid work experience.")
    recent_roles: List[str] = Field(default_factory=list, description="Recent job titles held by the candidate.")
    education_level: Optional[str] = Field(
        default=None,
        description="Highest degree obtained (e.g., Bachelor, Master, PhD).",
    )
    key_achievements: List[str] = Field(
        default_factory=list,
        description="Specific quantified claims from the resume.",
    )


class GapAnalysis(BaseModel):
    matching_skills: List[str] = Field(description="Skills required by JD that the candidate possesses.")
    missing_skills: List[str] = Field(description="Required skills missing from the candidate's resume.")
    experience_gap_years: float = Field(description="Candidate's experience minus required experience (diff).")
    overall_fit_score: int = Field(ge=0, le=100, description="Holistic match percentage from 0 to 100.")
    focus_areas: List[str] = Field(
        max_length=4,
        description="Strategic topics the interviewer MUST explore due to gaps or ambiguities.",
    )

    @field_validator("overall_fit_score")
    @classmethod
    def validate_score(cls, value: int) -> int:
        if value < 0 or value > 100:
            raise ValueError("Score must be between 0 and 100.")
        return value


class InterviewQuestion(BaseModel):
    topic: str = Field(description="The broader category or focus area of the question.")
    question_text: str = Field(description="Exact phrase the interviewer should speak/output.")
    expected_key_points: List[str] = Field(
        description="Technical concepts or STAR elements the ideal answer should hit."
    )
    rendered_text: str = Field(
        default="",
        description="Pre-rendered conversational delivery text. If empty, falls back to question_text.",
    )
    answer_guidance: str = Field(
        default="",
        description="Optional concise candidate-facing guidance for what a strong answer should cover.",
    )


class InterviewPlan(BaseModel):
    questions: List[InterviewQuestion] = Field(description="Ordered logic of questions to cover in the interview.")
    estimated_duration_minutes: int = Field(default=30, ge=5, description="Expected time box for the interview section.")

    @model_validator(mode="before")
    @classmethod
    def normalize_interview_plan(cls, data: Any) -> Any:
        if isinstance(data, list):
            data = {"questions": data}

        if isinstance(data, dict) and isinstance(data.get("questions"), list):
            config = get_interview_question_config()
            if len(data["questions"]) > config.max_questions:
                logger.warning(
                    "Truncating %s interview questions down to %s to meet configured limits.",
                    len(data["questions"]),
                    config.max_questions,
                )
                data["questions"] = data["questions"][: config.max_questions]

        return data

    @model_validator(mode="after")
    def validate_question_count(self):
        config = get_interview_question_config()
        question_count = len(self.questions)
        if question_count < config.min_questions:
            raise ValueError(
                f"InterviewPlan requires at least {config.min_questions} questions, got {question_count}."
            )
        if question_count > config.max_questions:
            raise ValueError(
                f"InterviewPlan supports at most {config.max_questions} questions, got {question_count}."
            )
        return self


class ScoreDimensions(BaseModel):
    technical_depth: int = Field(ge=0, le=10, description="Score for technical accuracy and depth.")
    communication_logic: int = Field(ge=0, le=10, description="Score for STAR principle usage and clarity.")
    problem_solving: int = Field(ge=0, le=10, description="Score for approach and closing the loop.")


class AnswerEvaluation(BaseModel):
    question: str = Field(description="The exact question asked.")
    answer: str = Field(description="The exact answer provided by the candidate.")
    dimensions: ScoreDimensions = Field(description="Segmented scores for the answer.")
    feedback: str = Field(description="Concrete feedback explaining WHY these scores were assigned.")
    missing_logic_elements: List[str] = Field(
        default_factory=list,
        description="Identified gaps in the answer logic based on STAR or reasoning coverage.",
    )


class HireRecommendation(str, Enum):
    STRONG_HIRE = "Strong Hire"
    HIRE = "Hire"
    LEAN_HIRE = "Lean Hire"
    NO_HIRE = "No Hire"


class RiskLevel(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class ResumeRisk(BaseModel):
    category: str = Field(description="Category of risk (e.g., Timeline, Tech, Role).")
    description: str = Field(description="Specific detail of the detected inconsistency.")
    risk_level: RiskLevel = Field(description="Severity of the risk.")

    @model_validator(mode="before")
    @classmethod
    def normalize_resume_risk(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if not data.get("category"):
            for alias in ("risk_type", "type", "kind"):
                alias_val = data.get(alias)
                if isinstance(alias_val, str) and alias_val.strip():
                    data["category"] = alias_val.strip()
                    break

        if not data.get("description"):
            for alias in ("detail", "details", "reason", "evidence"):
                alias_val = data.get(alias)
                if isinstance(alias_val, str) and alias_val.strip():
                    data["description"] = alias_val.strip()
                    break

        if not data.get("risk_level"):
            for alias in ("severity", "level"):
                alias_val = data.get(alias)
                if isinstance(alias_val, str) and alias_val.strip():
                    data["risk_level"] = alias_val.strip()
                    break

        risk_level = data.get("risk_level")
        if isinstance(risk_level, str) and risk_level.strip():
            raw = risk_level.strip()
            normalized = raw.lower()
            zh_to_en = {
                "低": "Low",
                "中": "Medium",
                "高": "High",
                "低风险": "Low",
                "中风险": "Medium",
                "高风险": "High",
            }
            if normalized in {"low", "medium", "high"}:
                data["risk_level"] = normalized.capitalize()
            elif raw in zh_to_en:
                data["risk_level"] = zh_to_en[raw]

        if not data.get("category"):
            data["category"] = "Unknown"
        if not data.get("description"):
            data["description"] = "No description provided."
        if not data.get("risk_level"):
            data["risk_level"] = "Low"

        return data


class AuditResult(BaseModel):
    risks: List[ResumeRisk] = Field(default_factory=list, description="List of identified risks.")
    summary: str = Field(description="Overall audit summary and integrity verdict.")

    @field_validator("risks")
    @classmethod
    def filter_placeholder_risks(cls, risks: List[ResumeRisk]) -> List[ResumeRisk]:
        cleaned: List[ResumeRisk] = []
        for risk in risks or []:
            is_placeholder = (
                risk.category == "Unknown"
                and risk.description == "No description provided."
                and risk.risk_level == RiskLevel.LOW
            )
            if not is_placeholder:
                cleaned.append(risk)
        return cleaned

    @model_validator(mode="before")
    @classmethod
    def normalize_audit_result(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if not data.get("summary"):
            for alias in ("audit_summary", "overall_summary", "verdict", "result_summary"):
                alias_val = data.get(alias)
                if isinstance(alias_val, str) and alias_val.strip():
                    data["summary"] = alias_val.strip()
                    break

        if not data.get("summary"):
            data["summary"] = "No explicit audit summary returned by model."

        return data


class EvidenceItem(BaseModel):
    claim: str = Field(description="The strength or weakness statement.")
    source_question_index: int = Field(
        default=-1,
        ge=-1,
        description="0-based index of the question that evidences this claim. -1 if general observation.",
    )


class FinalInterviewReport(BaseModel):
    candidate_name: str = Field(description="Candidate's name.")
    overall_score: int = Field(ge=0, le=100, description="Weighted cumulative score.")
    strengths: List[EvidenceItem] = Field(description="Observed strengths with evidence source.")
    weaknesses: List[EvidenceItem] = Field(description="Observed weaknesses with evidence source.")
    hire_recommendation: HireRecommendation = Field(description="Final hiring decision proposal.")
    detailed_evaluations: List[AnswerEvaluation] = Field(description="Log of all interactions.")


class HumanReviewDecision(BaseModel):
    approved: bool = Field(description="True if the human reviewer accepts the AI's FinalInterviewReport.")
    adjusted_score: Optional[int] = Field(default=None, ge=0, le=100, description="Human override for the overall score.")
    adjusted_recommendation: Optional[HireRecommendation] = Field(
        default=None,
        description="Human override for the evaluation.",
    )
    reviewer_comments: str = Field(description="Human reasoning for approval or override.")

    @model_validator(mode="after")
    def check_overrides(self):
        if not self.approved and not self.reviewer_comments:
            raise ValueError("If not approved, reviewer_comments must be provided explaining why.")
        return self


def validate_llm_json(json_data: dict, schema_class: type[BaseModel]) -> BaseModel:
    """
    Helper function to safely convert untyped JSON blobs into strict Pydantic structures.
    """
    try:
        return schema_class.model_validate(json_data)
    except Exception as exc:
        raise ValueError(f"Schema Validation Failed for {schema_class.__name__}: {str(exc)}")
