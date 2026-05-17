from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PrepareInterviewPayload(BaseModel):
    interviewId: str
    candidateId: str
    positionId: str
    mode: str = "async_qa"
    questionCount: int | None = None
    accessToken: str | None = None


class StartInterviewPayload(BaseModel):
    interviewId: str
    sessionId: str
    accessToken: str | None = None


class AppendTurnPayload(BaseModel):
    sessionId: str
    speaker: str
    content: str
    inputMode: str = "text"
    metadata: dict[str, Any] | None = None
    accessToken: str | None = None


class FinishInterviewPayload(BaseModel):
    interviewId: str
    sessionId: str
    accessToken: str | None = None


class ScoreInterviewPayload(BaseModel):
    interviewId: str
    sessionId: str
    accessToken: str | None = None


class ProctoringEventPayload(BaseModel):
    eventType: str
    severity: str
    confidence: float = 0.5
    startedAt: str
    endedAt: str | None = None
    durationMs: int = 0
    snapshotPaths: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] | None = None


class RecordProctoringEventsPayload(BaseModel):
    interviewId: str
    sessionId: str
    events: list[ProctoringEventPayload] = Field(default_factory=list)
    accessToken: str | None = None


class HumanConfirmPayload(BaseModel):
    interviewId: str
    reportId: str
    confirmed: bool
    finalRecommendation: str | None = None
    note: str | None = None


class RoomPasswordPayload(BaseModel):
    action: str
    interviewId: str
    password: str | None = None


class SignupEmailPayload(BaseModel):
    email: str
    password: str
    redirectTo: str | None = None


class AuthEmailPayload(BaseModel):
    email: str
    redirectTo: str | None = None


class VerifyRecoveryCodePayload(BaseModel):
    email: str
    code: str


class SalaryMarketRawRecordPayload(BaseModel):
    source_job_title: str
    source_city: str | None = None
    source_salary_text: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_period: str | None = "monthly"
    currency: str | None = "CNY"
    experience_text: str | None = None
    education_text: str | None = None
    company_name: str | None = None
    captured_at: str | None = None
    raw_payload: dict[str, Any] | None = None


class SalaryMarketImportPayload(BaseModel):
    source: str
    records: list[SalaryMarketRawRecordPayload]


class SalaryMarketRefreshPayload(BaseModel):
    min_samples: int = 2


class UpsertInterviewSchedulePayload(BaseModel):
    candidate_id: str | None = None
    name: str
    stage: str | None = None
    position: str | None = None
    schedule_time: str | None = None
    interviewer: str | None = None
    location_type: str | None = None
    status: str | None = None
    join_url: str | None = None


class CreateInterviewSessionPayload(BaseModel):
    interview_id: str
    candidate_id: str | None = None
    position_id: str | None = None
    mode: str | None = None
    status: str | None = None
    question_plan: list[dict[str, Any]] | None = None
    context_payload: dict[str, Any] | None = None


class UpdateInterviewSessionStatusPayload(BaseModel):
    status: str
    started_at: str | None = None
    ended_at: str | None = None


class CreateInterviewTurnPayload(BaseModel):
    session_id: str
    turn_no: int | None = None
    speaker: str
    content: str
    input_mode: str | None = None
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    confidence: float | None = None
    metadata: dict[str, Any] | None = None


class UpsertInterviewReportPayload(BaseModel):
    session_id: str
    interview_id: str
    candidate_id: str | None = None
    overall_score: int | None = None
    dimension_scores: dict[str, Any] | None = None
    strengths: list[dict[str, Any]] | None = None
    risks: list[dict[str, Any]] | None = None
    recommendation: str | None = None
    evidence: list[dict[str, Any]] | None = None
    summary: str | None = None
    risk_score: int | None = None
    human_confirmed: bool | None = None
    human_confirmed_by: str | None = None
    human_confirmed_at: str | None = None
    generated_by: str | None = None


class ScreeningReviewAcknowledgePayload(BaseModel):
    screening_recalc_needed: bool = False
    screening_recalc_reason: str | None = None
    screening_recalc_fields: list[str] | None = None
    screening_last_reviewed_at: str | None = None


class MatchManualReviewPayload(BaseModel):
    human_decision: str | None = None
    review_note: str | None = None
    reviewed_at: str | None = None


class DeleteUploadsPayload(BaseModel):
    upload_ids: list[str]
    storage_paths: list[str] | None = None


class MarkUploadsFailedPayload(BaseModel):
    upload_ids: list[str]
    error_code: str | None = "PROCESSING_STALLED"
    error_message: str | None = None


class HistoricalRescreenPayload(BaseModel):
    position_id: str
    candidate_ids: list[str]
    mode: str = "rule_only"


class UploadStatePatchPayload(BaseModel):
    patch: dict[str, Any]


class UploadTerminalPayload(BaseModel):
    message: str
    error_code: str | None = None


class CreateUploadPayload(BaseModel):
    position_id: str
    file_name: str
    file_path: str
    file_size_bytes: int | None = None
    mime_type: str | None = None
    file_hash: str | None = None


class PersistPhase1Payload(BaseModel):
    position: dict[str, Any]
    resume_upload_id: str
    file_hash: str
    job_requirement: dict[str, Any]
    candidate_patch: dict[str, Any]
    profile_payload: dict[str, Any]
    profile_llm_raw_json: dict[str, Any]
    profile_model_version: str
    match_output: dict[str, Any]
    match_llm_raw_json: dict[str, Any]
    match_model_version: str
    parsed_payload: dict[str, Any]


class ResolveJobRequirementPayload(BaseModel):
    position: dict[str, Any]


class PositionPayload(BaseModel):
    title: str
    department: str | None = None
    location: str | None = None
    status: str | None = None
    threshold_score: int | None = None
    technical_requirements: str | None = None
    max_age: int | None = None
    min_edu: str | None = None
    min_exp: int | None = None
    screening_recalc_needed: bool | None = None
    screening_recalc_reason: str | None = None
    screening_recalc_fields: list[str] | None = None
    screening_recalc_requested_at: str | None = None
    screening_last_reviewed_at: str | None = None


class DeleteCandidatesPayload(BaseModel):
    candidate_ids: list[str]


class CandidateSalaryProfilePatchPayload(BaseModel):
    offer_salary: float | None = None
    offer_status: str | None = None
    notes: str | None = None


class CompanySettingsPatchPayload(BaseModel):
    patch: dict[str, Any]


class LlmUsageEventPayload(BaseModel):
    model_id: str | None = None
    provider: str
    model_name: str
    api_protocol: str
    scene: str
    request_scope: str | None = None
    resume_upload_id: str | None = None
    candidate_id: str | None = None
    position_id: str | None = None
    interview_session_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int | None = None
    success: bool
    error_code: str | None = None
    metadata: dict[str, Any] | None = None


class AdminPermissionsPayload(BaseModel):
    new_permissions: list[str]


class AdminRolePayload(BaseModel):
    new_role: str
