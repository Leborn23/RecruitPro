import os
import logging
from contextlib import asynccontextmanager, nullcontext
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.agent.integration_service import RecruitmentIntegrationService
from src.agent.llm.config import ProviderConfig, use_llm_config_override
from src.agent.llm_service import default_llm
from src.agent.runtime_settings import get_runtime_settings_snapshot, validate_runtime_deployment_settings
from src.agent.schemas import CandidateProfile, JobProfile

load_dotenv()

logger = logging.getLogger(__name__)
service = RecruitmentIntegrationService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global service
    validate_runtime_deployment_settings()
    settings_snapshot = get_runtime_settings_snapshot()
    logger.info("Runtime settings: %s", settings_snapshot)
    try:
        yield
    finally:
        service.runtime.close()
        service = RecruitmentIntegrationService()


app = FastAPI(title="Recruitment Agent Gateway", version="0.1.0", lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled agent gateway error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "message": "Agent internal error",
            "metadata": {"error": str(exc)},
        },
    )


def _require_shared_secret(x_agent_secret: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv("AGENT_SHARED_SECRET", "").strip()
    if not expected:
        return
    if x_agent_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid agent secret")


class AgentLlmConfig(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class AgentStartRequest(BaseModel):
    session_id: str = Field(min_length=1)
    resume_text: str = Field(min_length=1)
    jd_text: str = Field(min_length=1)
    candidate_profile: Optional[CandidateProfile] = None
    job_profile: Optional[JobProfile] = None
    question_count: Optional[int] = Field(default=None, ge=1)
    llm_config: Optional[AgentLlmConfig] = None


class AgentAnswerRequest(BaseModel):
    session_id: str = Field(min_length=1)
    user_answer: str = Field(min_length=1)
    llm_config: Optional[AgentLlmConfig] = None


class AgentReviewRequest(BaseModel):
    session_id: str = Field(min_length=1)
    approved: bool
    comments: str = ""
    llm_config: Optional[AgentLlmConfig] = None


def _first_non_empty_env(*keys: str) -> Optional[str]:
    for key in keys:
        value = os.getenv(key)
        if value is not None and value.strip() != "":
            return value.strip()
    return None


def _resolve_provider_defaults(provider_name: str) -> tuple[Optional[str], Optional[str]]:
    provider = provider_name.strip().lower()
    shared_api_key = _first_non_empty_env("API_KEY", "LLM_API_KEY", "api_key")
    shared_base_url = _first_non_empty_env("BASE_URL", "LLM_BASE_URL", "base_url")

    if provider == "openai":
        return (
            _first_non_empty_env("OPENAI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("OPENAI_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url") or "https://api.openai.com/v1",
        )
    if provider == "moonshot":
        return (
            _first_non_empty_env("MOONSHOT_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("MOONSHOT_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url") or "https://api.moonshot.cn/v1",
        )
    if provider == "deepseek":
        return (
            _first_non_empty_env("DEEPSEEK_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("DEEPSEEK_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url") or "https://api.deepseek.com",
        )
    if provider == "qwen":
        return (
            _first_non_empty_env("DASHSCOPE_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("DASHSCOPE_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url")
            or "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
    if provider == "anthropic":
        return (
            _first_non_empty_env("ANTHROPIC_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("ANTHROPIC_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url"),
        )
    if provider == "gemini":
        return (
            _first_non_empty_env("GEMINI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("GEMINI_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url"),
        )
    if provider == "manual_openai":
        return (
            _first_non_empty_env("OPENAI_API_KEY", "API_KEY", "LLM_API_KEY", "api_key"),
            _first_non_empty_env("OPENAI_BASE_URL", "BASE_URL", "LLM_BASE_URL", "base_url"),
        )
    return shared_api_key, shared_base_url


def _provider_override(config: Optional[AgentLlmConfig]):
    if config is None:
        return nullcontext()

    provider_name = config.provider.strip().lower()
    default_api_key, default_base_url = _resolve_provider_defaults(provider_name)

    provider_config = ProviderConfig(
        provider_name=provider_name,
        model=config.model.strip(),
        api_key=(config.api_key or "").strip() or default_api_key,
        base_url=(config.base_url or "").strip() or default_base_url,
    )
    return use_llm_config_override(provider_config)


def _build_state_snapshot(session_id: str) -> Dict[str, Any]:
    state = service.runtime.graph.get_state({"configurable": {"thread_id": session_id}})
    values = state.values
    plan = values.get("interview_plan")
    questions = getattr(plan, "questions", None)
    return {
        "asked_question_count": len(values.get("asked_questions", []) or []),
        "answer_count": len(values.get("answers", []) or []),
        "planned_question_count": len(questions or []),
        "next_nodes": list(state.next or []),
    }


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true"}


@app.get("/agent/runtime-config")
def agent_runtime_config(_auth: None = Depends(_require_shared_secret)) -> Dict[str, Any]:
    return get_runtime_settings_snapshot()


@app.post("/agent/start")
def start_agent_interview(
    payload: AgentStartRequest, _auth: None = Depends(_require_shared_secret)
) -> Dict[str, Any]:
    with _provider_override(payload.llm_config):
        default_llm.reset()
        try:
            response = service.start_candidate_interview(
                payload.session_id,
                payload.resume_text,
                payload.jd_text,
                candidate_profile=payload.candidate_profile,
                job_profile=payload.job_profile,
                question_count=payload.question_count,
            )
        finally:
            default_llm.reset()
    return {
        **response.model_dump(mode="json"),
        "state_snapshot": _build_state_snapshot(payload.session_id),
    }


@app.post("/agent/answer")
def answer_agent_interview(
    payload: AgentAnswerRequest, _auth: None = Depends(_require_shared_secret)
) -> Dict[str, Any]:
    with _provider_override(payload.llm_config):
        default_llm.reset()
        try:
            response = service.handle_user_interaction(payload.session_id, payload.user_answer)
        finally:
            default_llm.reset()
    return {
        **response.model_dump(mode="json"),
        "state_snapshot": _build_state_snapshot(payload.session_id),
    }


@app.post("/agent/review")
def review_agent_interview(
    payload: AgentReviewRequest, _auth: None = Depends(_require_shared_secret)
) -> Dict[str, Any]:
    with _provider_override(payload.llm_config):
        default_llm.reset()
        try:
            response = service.finalize_by_hr(payload.session_id, payload.approved, payload.comments)
        finally:
            default_llm.reset()
    return {
        **response.model_dump(mode="json"),
        "state_snapshot": _build_state_snapshot(payload.session_id),
    }


@app.get("/agent/status")
def agent_status(
    session_id: str = Query(min_length=1), _auth: None = Depends(_require_shared_secret)
) -> Dict[str, Any]:
    response = service.get_interview_summary(session_id)
    runtime_status = service.runtime.get_session_status(session_id)
    return {
        "summary": response,
        "response": runtime_status.model_dump(mode="json"),
        "state_snapshot": _build_state_snapshot(session_id),
    }
