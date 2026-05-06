from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

from models import (
    AdminPermissionsPayload,
    AdminRolePayload,
    AppendTurnPayload,
    CandidateSalaryProfilePatchPayload,
    CompanySettingsPatchPayload,
    CreateInterviewSessionPayload,
    CreateInterviewTurnPayload,
    CreateUploadPayload,
    DeleteCandidatesPayload,
    DeleteUploadsPayload,
    FinishInterviewPayload,
    HistoricalRescreenPayload,
    HumanConfirmPayload,
    LlmUsageEventPayload,
    MarkUploadsFailedPayload,
    MatchManualReviewPayload,
    PersistPhase1Payload,
    PositionPayload,
    PrepareInterviewPayload,
    ProctoringEventPayload,
    RecordProctoringEventsPayload,
    ResolveJobRequirementPayload,
    RoomPasswordPayload,
    SalaryMarketImportPayload,
    SalaryMarketRawRecordPayload,
    SalaryMarketRefreshPayload,
    ScoreInterviewPayload,
    ScreeningReviewAcknowledgePayload,
    StartInterviewPayload,
    UpdateInterviewSessionStatusPayload,
    UploadStatePatchPayload,
    UploadTerminalPayload,
    UpsertInterviewReportPayload,
    UpsertInterviewSchedulePayload,
)

PROCTORING_EVENT_TYPES = {
    "camera_denied",
    "camera_closed",
    "no_face",
    "multiple_faces",
    "off_screen_attention",
    "page_hidden",
    "window_blur",
}
PROCTORING_SEVERITIES = {"low", "medium", "high"}
PROCTORING_EVENT_LABELS = {
    "camera_denied": "摄像头权限被拒绝",
    "camera_closed": "摄像头关闭",
    "no_face": "未检测到人脸",
    "multiple_faces": "多人入镜",
    "off_screen_attention": "视线离屏",
    "page_hidden": "页面隐藏",
    "window_blur": "窗口失焦",
}

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env.local", override=False)
load_dotenv(ROOT_DIR / "backend" / ".env", override=True)


def env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name, fallback)
    if value is None or not str(value).strip():
        raise RuntimeError(f"Missing required env: {name}")
    return value.strip()


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def to_string_array(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        if isinstance(item, str):
            text = normalize_text(item)
            if text:
                output.append(text)
            continue
        if isinstance(item, dict):
            candidate = (
                normalize_text(item.get("name"))
                or normalize_text(item.get("skill"))
                or normalize_text(item.get("value"))
                or normalize_text(item.get("label"))
                or normalize_text(item.get("summary"))
                or normalize_text(item.get("title"))
            )
            if candidate:
                output.append(candidate)
    return output


def split_skills(text: str) -> list[str]:
    import re

    return [
        item.strip()
        for item in re.split(r"[\n,，;；、|/ ]+", text)
        if item and len(item.strip()) >= 2
    ][:20]


def extract_skills_from_requirement(requirement_text: str | None) -> list[str]:
    base = normalize_text(requirement_text)
    if not base:
        return []
    output: list[str] = []
    seen: set[str] = set()
    for item in split_skills(base):
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output[:8]


def dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        text = normalize_text(item)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def to_number(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed != parsed:
            return fallback
        return parsed
    except (TypeError, ValueError):
        return fallback


def normalize_skill(value: str | None) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    mapping = {
        "golang": "Golang",
        "go": "Golang",
        "ts": "TypeScript",
        "node": "Node.js",
        "k8s": "Kubernetes",
    }
    lower = text.lower()
    return mapping.get(lower, text)


def score_to_recommendation(score: int) -> str:
    if score >= 85:
        return "strong_match"
    if score >= 70:
        return "partial_match"
    if score >= 55:
        return "weak_match"
    return "reject"


def recommendation_to_tag(recommendation: str) -> str:
    if recommendation == "strong_match":
        return "精准匹配"
    if recommendation == "partial_match":
        return "建议复核"
    if recommendation == "weak_match":
        return "潜力待定"
    return "不推荐"


def education_rank(level: str | None) -> int:
    text = normalize_text(level)
    if "博士" in text:
        return 4
    if "硕士" in text:
        return 3
    if "本科" in text:
        return 2
    if "大专" in text or "专科" in text:
        return 1
    return 0


KNOWN_SKILLS = [
    "Python", "Java", "Golang", "Go", "TypeScript", "JavaScript", "Node.js", "React", "Vue",
    "Docker", "Kubernetes", "Kafka", "Redis", "MySQL", "PostgreSQL", "Linux", "AWS",
    "微服务", "分布式", "高并发", "OCR", "LLM", "机器学习", "深度学习", "计算机视觉",
]


def contains_cjk(text: str | None) -> bool:
    return bool(text and re.search(r"[\u4e00-\u9fa5]", text))


def detect_skills(text: str) -> list[str]:
    lower = text.lower()
    found = [normalize_skill(skill) for skill in KNOWN_SKILLS if skill.lower() in lower]
    return dedupe_keep_order(found)


def split_sentences(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"[\n。！？!?;.]+", text) if len(item.strip()) >= 8]


def build_evidence_spans(text: str) -> list[dict[str, Any]]:
    sentences = split_sentences(text)[:20]
    cursor = 0
    output: list[dict[str, Any]] = []
    for index, sentence in enumerate(sentences, start=1):
        start = max(text.find(sentence, cursor), 0)
        end = start + len(sentence)
        cursor = end
        output.append(
            {
                "span_id": f"sp_{index}",
                "page_no": None,
                "char_start": start,
                "char_end": end,
                "text_excerpt": sentence[:260],
            }
        )
    return output


def parse_basic_profile(text: str, file_name: str) -> dict[str, Any]:
    name = re.sub(r"\.(pdf|doc|docx)$", "", file_name, flags=re.IGNORECASE)
    years_match = re.search(r"(\d{1,2})\s*年", text)
    title = None
    for keyword in ["工程师", "开发", "算法", "产品", "测试", "架构师", "运营"]:
        if keyword in text:
            idx = text.find(keyword)
            snippet = text[max(0, idx - 8): idx + len(keyword) + 8].strip("：:，, ")
            if len(snippet) >= len(keyword):
                title = snippet
                break
    return {
        "full_name": name or None,
        "email": None,
        "phone": None,
        "current_title": title,
        "years_of_experience": int(years_match.group(1)) if years_match else None,
    }


def parse_education(text: str) -> list[dict[str, Any]]:
    for level in ["博士", "硕士", "本科", "大专", "专科"]:
        if level in text:
            return [{"degree": level}]
    return []


def parse_projects(text: str, spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sentences = split_sentences(text)
    output: list[dict[str, Any]] = []
    skills = detect_skills(text)
    for sentence in sentences[:4]:
        if len(sentence) < 12:
            continue
        output.append(
            {
                "project_name": sentence[:24],
                "project_summary": sentence[:200],
                "candidate_role": None,
                "responsibilities": [sentence[:120]],
                "tech_stack": skills[:6],
                "domain": None,
                "complexity_level": "high" if any(token in sentence for token in ["高并发", "分布式", "千万", "亿级"]) else "medium",
                "leadership_level": "lead" if any(token in sentence for token in ["主导", "负责人", "lead"]) else "used",
                "evidence_spans": [spans[0]["span_id"]] if spans else [],
                "confidence": 0.7,
            }
        )
    return output[:3]


def build_resume_profile_from_text(file_name: str, text: str, quality: str) -> dict[str, Any]:
    spans = build_evidence_spans(text)
    explicit_skills = [{"skill": item, "confidence": 0.82, "evidence_span_ids": [spans[0]["span_id"]] if spans else []} for item in detect_skills(text)[:12]]
    inferred_skills = [{"skill": item, "confidence": 0.7, "evidence_span_ids": [spans[0]["span_id"]] if spans else [], "inference_reason": "文本命中"} for item in detect_skills(text)[:8]]
    projects = parse_projects(text, spans)
    education = parse_education(text)
    profile = {
        "basic_profile": parse_basic_profile(text, file_name),
        "explicit_skills": explicit_skills,
        "inferred_skills": inferred_skills,
        "projects": projects,
        "work_experience": [],
        "education": education,
        "certifications": [],
        "risk_flags": [],
        "extraction_confidence": {
            "overall": 0.8 if quality == "good" else 0.58,
            "by_section": {
                "projects": 0.82 if projects else 0.45,
                "skills": 0.8 if explicit_skills else 0.42,
                "education": 0.9 if education else 0.5,
            },
        },
        "evidence_spans": spans,
    }
    if quality != "good":
        profile["risk_flags"].append({"type": "text_quality", "severity": "medium", "message": "文本质量较弱，建议人工复核"})
    return profile


def extract_text_from_ocr_payload(raw: Any) -> str | None:
    obj = raw if isinstance(raw, dict) else {}
    direct = normalize_text(obj.get("text")) or normalize_text(obj.get("content")) or normalize_text(obj.get("result"))
    if direct:
        return direct
    nested_result = obj.get("result") if isinstance(obj.get("result"), dict) else {}
    nested_text = normalize_text(nested_result.get("text")) or normalize_text(nested_result.get("content"))
    if nested_text:
        return nested_text
    data_obj = obj.get("data") if isinstance(obj.get("data"), dict) else {}
    data_text = normalize_text(data_obj.get("text")) or normalize_text(data_obj.get("content"))
    return data_text or None


async def call_ocr_service(content: bytes, file_name: str, config: dict[str, Any]) -> str | None:
    if not config.get("enabled") or not normalize_text(config.get("base_url")):
        return None

    headers: dict[str, str] = {}
    api_key = normalize_text(config.get("api_key"))
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["x-api-key"] = api_key

    timeout_ms = max(5000, min(180000, int(to_number(config.get("timeout_ms"), 45000))))
    files = {"file": (file_name, content, "application/octet-stream")}

    async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
        response = await client.post(str(config["base_url"]), headers=headers, files=files)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            text = extract_text_from_ocr_payload(response.json())
            return text if normalize_text(text) else None
        text = response.text.strip()
        return text if text else None


def get_screening_runtime_data(client: Client) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    company_settings = db.first(
        client.table("company_settings")
        .select(
            "active_llm_model_id,llm_retry_enabled,llm_strategy_mode,ocr_enabled,ocr_base_url,ocr_api_key,ocr_timeout_ms,match_weight_must_have,match_weight_skills,match_weight_project,match_weight_experience,match_weight_education"
        )
        .limit(1)
        .execute()
    ) or {}
    llm_models = db.many(
        client.table("llm_model_configs")
        .select("id,provider,mode,model_name,base_url,api_key_encrypted,api_version,max_tokens,temperature,timeout_ms,is_active,created_at")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    return company_settings, llm_models


def extract_text_from_upload(file_name: str, content: bytes) -> tuple[str, str, str]:
    extension = Path(file_name).suffix.lower()
    text = ""
    source = "decode"
    try:
        if extension == ".pdf":
            from pypdf import PdfReader
            import io

            reader = PdfReader(io.BytesIO(content))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            source = "pypdf"
        elif extension == ".docx":
            from docx import Document
            import io

            document = Document(io.BytesIO(content))
            text = "\n".join(paragraph.text for paragraph in document.paragraphs)
            source = "docx"
    except Exception:
        text = ""

    if not text.strip():
        text = content.decode("utf-8", errors="ignore") or content.decode("gbk", errors="ignore")
        source = "decode"

    normalized = re.sub(r"\s+", " ", text).strip()
    quality = "good" if len(normalized) >= 120 else "poor"
    return normalized[:20000], quality, source


def merge_resume_skill_hints(candidate: dict[str, Any]) -> list[str]:
    title_skills = split_skills(normalize_text(candidate.get("title")))
    highlight_skills = split_skills(normalize_text(candidate.get("highlight")))
    resume_skills = candidate.get("resume_skills") if isinstance(candidate.get("resume_skills"), list) else []
    return dedupe_keep_order([*resume_skills, *title_skills, *highlight_skills])[:12]


def pick_personalized_project_hint(candidate: dict[str, Any]) -> str:
    projects = candidate.get("resume_projects") if isinstance(candidate.get("resume_projects"), list) else []
    if projects and normalize_text(projects[0]):
        return normalize_text(projects[0])
    if normalize_text(candidate.get("prev_company")):
        return f"{candidate['prev_company']} 相关项目"
    return "你最近一个最有代表性的项目"


def pick_personalized_work_hint(candidate: dict[str, Any]) -> str:
    work_items = candidate.get("resume_work_items") if isinstance(candidate.get("resume_work_items"), list) else []
    if work_items and normalize_text(work_items[0]):
        return normalize_text(work_items[0])
    if normalize_text(candidate.get("title")):
        return f"{candidate['title']} 岗位经历"
    return "你最近一段工作经历"


def build_question_prompt_with_skill(base_skill: str | None, fallback_prompt: str) -> str:
    skill = normalize_text(base_skill)
    if not skill:
        return fallback_prompt
    return f"围绕 {skill}，讲一个你亲自处理过的复杂场景：背景、关键动作、技术取舍与结果。"


def build_question_plan(candidate: dict[str, Any], position: dict[str, Any]) -> list[dict[str, Any]]:
    position_title = normalize_text(position.get("title")) or "该岗位"
    jd_skills = extract_skills_from_requirement(position.get("technical_requirements"))
    candidate_skills = merge_resume_skill_hints(candidate)
    project_hint = pick_personalized_project_hint(candidate)
    work_hint = pick_personalized_work_hint(candidate)

    matched_skills: list[str] = []
    for jd_skill in jd_skills:
        for candidate_skill in candidate_skills:
            left = jd_skill.lower()
            right = candidate_skill.lower()
            if left in right or right in left:
                matched_skills.append(jd_skill)
                break

    core_skill_a = jd_skills[0] if jd_skills else (matched_skills[0] if matched_skills else "岗位核心技术")
    core_skill_b = jd_skills[1] if len(jd_skills) > 1 else (jd_skills[0] if jd_skills else "高并发与稳定性")
    personal_skill = matched_skills[0] if matched_skills else (candidate_skills[0] if candidate_skills else core_skill_a)

    questions = [
        {
            "id": "core-1-role-fit",
            "dimension": "role_fit",
            "difficulty": "easy",
            "prompt": f"请用 2 分钟介绍你与 {position_title} 最相关的一段经历，并说明你选择这个岗位的核心原因。",
            "expected_signals": ["岗位动机", "相关经历", "职责匹配"],
        },
        {
            "id": "core-2-tech-depth",
            "dimension": "technical_depth",
            "difficulty": "medium",
            "prompt": build_question_prompt_with_skill(core_skill_a, "请讲一个你亲自处理过的复杂技术问题：背景、排查路径、最终方案与取舍。"),
            "expected_signals": ["技术细节", "排查路径", "方案取舍", "结果"],
        },
        {
            "id": "core-3-problem-solving",
            "dimension": "problem_solving",
            "difficulty": "hard",
            "prompt": f"如果 {core_skill_b} 相关链路在高峰期出现抖动，你会如何在 30 分钟内完成止损、定位和恢复？",
            "expected_signals": ["优先级", "应急动作", "验证与回滚"],
        },
        {
            "id": "core-4-communication",
            "dimension": "communication",
            "difficulty": "medium",
            "prompt": "讲一个你与产品/测试/业务存在明显分歧的案例，你如何达成一致并推进上线？",
            "expected_signals": ["沟通对象", "分歧处理", "协作结果"],
        },
        {
            "id": "core-5-ownership",
            "dimension": "ownership",
            "difficulty": "medium",
            "prompt": "过去一年你主导推进的最有代表性改进是什么？你为何主导、如何推进、最终影响是什么？",
            "expected_signals": ["主导动作", "跨团队推动", "业务/技术影响"],
        },
        {
            "id": "per-1-project-evidence",
            "dimension": "project_evidence",
            "difficulty": "medium",
            "prompt": f"你简历里提到“{project_hint}”，请拆解这段经历：你的具体职责、关键决策、量化结果分别是什么？",
            "expected_signals": ["职责边界", "关键动作", "量化结果"],
        },
        {
            "id": "per-2-skill-evidence",
            "dimension": "technical_depth",
            "difficulty": "hard",
            "prompt": f"结合你在 {personal_skill} 上的实践，讲一个你做过技术取舍的案例：为什么这么选？备选方案是什么？",
            "expected_signals": ["方案对比", "取舍原因", "最终结果"],
        },
        {
            "id": "per-3-work-fit",
            "dimension": "project_evidence",
            "difficulty": "medium",
            "prompt": f"围绕“{work_hint}”，请说明你亲自负责的关键任务、你推动的改进，以及可验证的产出指标。",
            "expected_signals": ["亲自负责", "改进动作", "可验证证据"],
        },
    ]
    return questions[:8]


def to_work_hints(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    hints: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        company = normalize_text(item.get("company"))
        role = normalize_text(item.get("title")) or normalize_text(item.get("role")) or normalize_text(item.get("position"))
        summary = normalize_text(item.get("summary")) or normalize_text(item.get("description"))
        merged = " / ".join(part for part in [company, role, summary] if part)
        if merged:
            hints.append(merged)
            continue
        responsibilities = "；".join(to_string_array(item.get("responsibilities"))[:2])
        if responsibilities:
            hints.append(responsibilities)
    return hints


def build_resume_text(candidate: dict[str, Any], profile: dict[str, Any] | None, projects: list[dict[str, Any]]) -> str:
    explicit_skills = to_string_array(profile.get("explicit_skills") if profile else None)[:12]
    inferred_skills = to_string_array(profile.get("inferred_skills") if profile else None)[:12]
    work_items = to_string_array(profile.get("work_experience") if profile else None)[:6]
    project_lines = []
    for project in projects[:5]:
        parts = [
            normalize_text(project.get("project_name")),
            normalize_text(project.get("candidate_role")),
            normalize_text(project.get("project_summary")),
            " / ".join(to_string_array(project.get("tech_stack"))[:5]),
        ]
        line = " | ".join(part for part in parts if part)
        if line:
            project_lines.append(line)

    parser_raw_json = profile.get("parser_raw_json") if profile else None
    preview = normalize_text(parser_raw_json.get("text_preview")) if isinstance(parser_raw_json, dict) else ""

    lines = [
        f"Candidate name: {candidate.get('name') or 'unknown'}",
        f"Current or target role: {candidate.get('title') or 'unknown'}",
        f"Previous company: {candidate.get('prev_company') or 'unknown'}",
        f"Highlight summary: {candidate.get('highlight') or 'none'}",
        f"Explicit skills: {', '.join(explicit_skills)}" if explicit_skills else "",
        f"Inferred skills: {', '.join(inferred_skills)}" if inferred_skills else "",
        f"Work experience cues:\n- {'\n- '.join(work_items)}" if work_items else "",
        f"Project experience:\n- {'\n- '.join(project_lines)}" if project_lines else "",
        f"Resume text preview:\n{preview}" if preview else "",
    ]
    return "\n\n".join(line for line in lines if line)


def map_resume_context_to_candidate_profile(candidate: dict[str, Any], profile: dict[str, Any] | None, projects: list[dict[str, Any]]) -> dict[str, Any]:
    explicit_skills = to_string_array(profile.get("explicit_skills") if profile else None)[:15]
    inferred_skills = to_string_array(profile.get("inferred_skills") if profile else None)[:10]
    work_items = to_string_array(profile.get("work_experience") if profile else None)[:5]
    project_lines = []
    for project in projects[:5]:
        line = " | ".join(
            part
            for part in [
                normalize_text(project.get("project_name")),
                normalize_text(project.get("candidate_role")),
                normalize_text(project.get("project_summary")),
            ]
            if part
        )
        if line:
            project_lines.append(line)

    basic_profile = profile.get("basic_profile") if profile and isinstance(profile.get("basic_profile"), dict) else {}
    raw_years = basic_profile.get("years_of_experience")
    try:
        experience_years = max(0, float(raw_years))
    except (TypeError, ValueError):
        experience_years = 0

    return {
        "name": normalize_text(candidate.get("name")) or normalize_text(basic_profile.get("full_name")) or "unknown",
        "skills": list(dict.fromkeys([*explicit_skills, *inferred_skills]))[:20],
        "experience_years": experience_years,
        "recent_roles": [
            part
            for part in [
                normalize_text(candidate.get("title")) or normalize_text(basic_profile.get("current_title")),
                *work_items,
            ]
            if part
        ][:6],
        "education_level": normalize_text(basic_profile.get("education_level")) or None,
        "key_achievements": [part for part in [normalize_text(candidate.get("highlight")), *project_lines] if part][:8],
    }


def build_job_description_text(position: dict[str, Any], parsed_requirement: dict[str, Any] | None) -> str:
    must_have = to_string_array(parsed_requirement.get("must_have_skills") if parsed_requirement else None)[:12]
    nice_to_have = to_string_array(parsed_requirement.get("nice_to_have_skills") if parsed_requirement else None)[:8]
    responsibilities = to_string_array(parsed_requirement.get("core_responsibilities") if parsed_requirement else None)[:8]
    source_text = normalize_text(parsed_requirement.get("source_text")) if parsed_requirement else ""
    lines = [
        f"Job title: {position.get('title') or 'unknown'}",
        f"Department: {position.get('department') or 'unknown'}",
        f"Minimum experience: {position.get('min_exp') or 'unknown'}",
        f"Minimum education: {position.get('min_edu') or 'unknown'}",
        f"Technical requirements:\n{normalize_text(position.get('technical_requirements'))}" if normalize_text(position.get("technical_requirements")) else "",
        f"Must-have skills: {', '.join(must_have)}" if must_have else "",
        f"Nice-to-have skills: {', '.join(nice_to_have)}" if nice_to_have else "",
        f"Core responsibilities:\n- {'\n- '.join(responsibilities)}" if responsibilities else "",
        f"Job source text:\n{source_text}" if source_text else "",
    ]
    return "\n\n".join(line for line in lines if line)


def map_job_context_to_job_profile(position: dict[str, Any], parsed_requirement: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "title": normalize_text(position.get("title")) or "unknown",
        "required_skills": to_string_array(parsed_requirement.get("must_have_skills") if parsed_requirement else None)[:15],
        "experience_years": position.get("min_exp") or 0,
        "key_responsibilities": to_string_array(parsed_requirement.get("core_responsibilities") if parsed_requirement else None)[:8],
    }


def map_agent_recommendation(value: str | None) -> str:
    normalized = normalize_text(value).lower()
    if normalized in {"strong hire", "hire"}:
        return "hire"
    if normalized == "lean hire":
        return "hold"
    if normalized == "no hire":
        return "reject"
    return "needs_review"


def clamp(value: float, lower: int = 0, upper: int = 100) -> int:
    return max(lower, min(upper, round(value)))


def map_agent_report_to_interview_report(final_report: dict[str, Any]) -> dict[str, Any]:
    evaluations = final_report.get("detailed_evaluations") if isinstance(final_report.get("detailed_evaluations"), list) else []
    strengths = [
        normalize_text(item.get("claim"))
        for item in final_report.get("strengths", [])
        if isinstance(item, dict) and normalize_text(item.get("claim"))
    ]
    risks = [
        normalize_text(item.get("claim"))
        for item in final_report.get("weaknesses", [])
        if isinstance(item, dict) and normalize_text(item.get("claim"))
    ]

    def average(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    technical = clamp(average([float((item.get("dimensions") or {}).get("technical_depth", 0)) for item in evaluations]) * 10)
    communication = clamp(average([float((item.get("dimensions") or {}).get("communication_logic", 0)) for item in evaluations]) * 10)
    problem_solving = clamp(average([float((item.get("dimensions") or {}).get("problem_solving", 0)) for item in evaluations]) * 10)
    overall_raw = final_report.get("overall_score")
    overall_score = int(overall_raw) if isinstance(overall_raw, (int, float)) else None
    recommendation = map_agent_recommendation(final_report.get("hire_recommendation"))
    risk_score = clamp(100 - overall_score + len(risks) * 8) if overall_score is not None else None
    summary_lines = [f"Recommendation: {recommendation}. Overall score: {overall_score if overall_score is not None else '-'}."]
    if strengths:
        summary_lines.append(f"Strengths: {'; '.join(strengths)}")
    if risks:
        summary_lines.append(f"Risks: {'; '.join(risks)}")

    return {
        "overall_score": overall_score,
        "dimension_scores": {
            "technical_depth": technical,
            "communication": communication,
            "problem_solving": problem_solving,
        },
        "strengths": strengths,
        "risks": risks,
        "recommendation": recommendation,
        "evidence": [
            {
                "question_index": index,
                "question": item.get("question") or "",
                "answer": item.get("answer") or "",
                "feedback": item.get("feedback") or "",
                "missing_logic_elements": item.get("missing_logic_elements") if isinstance(item.get("missing_logic_elements"), list) else [],
                "dimensions": item.get("dimensions") if isinstance(item.get("dimensions"), dict) else {},
            }
            for index, item in enumerate(evaluations)
            if isinstance(item, dict)
        ],
        "summary": "\n".join(summary_lines),
        "risk_score": risk_score,
    }


def build_proctoring_summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    severity_counts = {"high": 0, "medium": 0, "low": 0}
    grouped: dict[str, dict[str, Any]] = {}
    snapshot_paths: list[str] = []
    details: list[dict[str, Any]] = []

    for event in events:
        if not isinstance(event, dict):
            continue
        severity = normalize_text(event.get("severity"))
        if severity in severity_counts:
            severity_counts[severity] += 1

        event_type = normalize_text(event.get("event_type"))
        label = PROCTORING_EVENT_LABELS.get(event_type, event_type or "未知监考事件")
        group = grouped.setdefault(
            event_type or "unknown",
            {
                "event_type": event_type or "unknown",
                "label": label,
                "count": 0,
                "high_count": 0,
                "medium_count": 0,
                "low_count": 0,
            },
        )
        group["count"] += 1
        if severity in severity_counts:
            group[f"{severity}_count"] += 1

        metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        detail = {
            "event_type": event_type or "unknown",
            "label": label,
            "severity": severity or "low",
            "duration_ms": int(to_number(event.get("duration_ms"), 0)),
            "confidence": to_number(event.get("confidence"), None),
            "face_count": int(to_number(metadata.get("face_count"), 0)) if metadata.get("face_count") is not None else None,
            "face_score": to_number(metadata.get("face_score"), None),
            "attention_signal": normalize_text(metadata.get("attention_signal")),
            "started_at": event.get("started_at"),
            "ended_at": event.get("ended_at"),
        }
        details.append(detail)

        raw_paths = event.get("snapshot_paths") if isinstance(event.get("snapshot_paths"), list) else []
        for path in raw_paths:
            text = normalize_text(path)
            if text and len(snapshot_paths) < 12:
                snapshot_paths.append(text)

    high_count = severity_counts["high"]
    medium_count = severity_counts["medium"]
    low_count = severity_counts["low"]
    event_count = high_count + medium_count + low_count
    risk_score = min(100, high_count * 25 + medium_count * 10 + low_count * 3)
    grouped_summary = sorted(grouped.values(), key=lambda item: (-int(item["count"]), str(item["label"])))

    return {
        "event_count": event_count,
        "high_count": high_count,
        "medium_count": medium_count,
        "low_count": low_count,
        "risk_score": risk_score,
        "grouped_summary": grouped_summary,
        "snapshot_paths": snapshot_paths,
        "details": details[:20],
    }


def merge_proctoring_into_report(mapped: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    event_count = int(to_number(summary.get("event_count"), 0))
    if event_count <= 0:
        return mapped

    risk_score = int(to_number(summary.get("risk_score"), 0))
    high_count = int(to_number(summary.get("high_count"), 0))
    medium_count = int(to_number(summary.get("medium_count"), 0))
    low_count = int(to_number(summary.get("low_count"), 0))
    severity = "high" if high_count > 0 else ("medium" if medium_count > 0 else "low")
    labels = [
        f"{item.get('label')} x{item.get('count')}"
        for item in summary.get("grouped_summary", [])
        if isinstance(item, dict) and item.get("label") and item.get("count")
    ]
    message = (
        f"监考风险：检测到{('、'.join(labels) if labels else '异常行为')}，"
        f"共 {event_count} 次（高 {high_count} / 中 {medium_count} / 低 {low_count}）。"
    )

    risks = mapped.get("risks") if isinstance(mapped.get("risks"), list) else []
    risks.append(
        {
            "type": "proctoring",
            "severity": severity,
            "message": message,
            "event_count": event_count,
        }
    )
    mapped["risks"] = risks

    evidence = mapped.get("evidence") if isinstance(mapped.get("evidence"), list) else []
    evidence_summary = "，".join(labels) if labels else message
    evidence.append(
        {
            "type": "proctoring",
            "summary": evidence_summary,
            "grouped_summary": summary.get("grouped_summary", []),
            "details": summary.get("details", []),
            "event_count": event_count,
            "risk_score": risk_score,
            "snapshot_paths": summary.get("snapshot_paths", []),
        }
    )
    mapped["evidence"] = evidence

    existing_risk_score = mapped.get("risk_score")
    mapped["risk_score"] = max(int(to_number(existing_risk_score, 0)), risk_score)
    if high_count > 0 or risk_score >= 40:
        mapped["recommendation"] = "needs_review"
    return mapped


def is_placeholder_interview_report_summary(value: Any) -> bool:
    text = normalize_text(value).lower()
    return "waiting for human confirmation" in text or "waiting to generate" in text


def estimate_turn_answer_score(answer: str) -> int:
    text = normalize_text(answer)
    if not text:
        return 20
    lowered = text.lower()
    weak_markers = ("不会", "不太会", "不知道", "不了解", "不清楚", "不会答")
    if any(marker in lowered for marker in weak_markers):
        return 25
    length = len(text)
    if length >= 220:
        return 78
    if length >= 120:
        return 68
    if length >= 50:
        return 55
    return 40


def build_recovered_report_from_turns(turns: list[dict[str, Any]]) -> dict[str, Any] | None:
    evaluations: list[dict[str, Any]] = []
    ai_prompt: str | None = None
    ai_kind = ""
    for turn in turns:
        speaker = normalize_text(turn.get("speaker"))
        content = normalize_text(turn.get("content"))
        metadata = turn.get("metadata") if isinstance(turn.get("metadata"), dict) else {}
        kind = normalize_text(metadata.get("kind"))
        if speaker == "ai" and kind in {"question", "followup"} and content and not is_agent_system_error_message(content):
            ai_prompt = content
            ai_kind = kind
            continue
        if speaker == "candidate" and ai_prompt and content:
            score = estimate_turn_answer_score(content)
            dimension_score = max(1, min(10, round(score / 10)))
            evaluations.append(
                {
                    "question": ai_prompt,
                    "answer": content,
                    "feedback": "Recovered from persisted interview turns because the agent runtime session was unavailable.",
                    "dimensions": {
                        "technical_depth": dimension_score,
                        "communication_logic": dimension_score,
                        "problem_solving": dimension_score,
                    },
                    "kind": ai_kind,
                }
            )
            ai_prompt = None
            ai_kind = ""

    if not evaluations:
        return None

    scores = [
        float((item.get("dimensions") or {}).get("technical_depth", 0)) * 10
        for item in evaluations
        if isinstance(item.get("dimensions"), dict)
    ]
    overall_score = clamp(sum(scores) / len(scores)) if scores else 45
    recommendation = "lean hire" if overall_score >= 60 else "no hire"
    strengths = [{"claim": "Candidate provided recoverable interview answers."}] if overall_score >= 55 else []
    weaknesses = []
    if overall_score < 60:
        weaknesses.append({"claim": "Answers were brief or lacked sufficient technical detail."})
    return {
        "overall_score": overall_score,
        "hire_recommendation": recommendation,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detailed_evaluations": evaluations,
    }


def map_agent_plan_to_question_plan(interview_plan: dict[str, Any] | None) -> list[dict[str, Any]]:
    questions = interview_plan.get("questions") if isinstance(interview_plan, dict) and isinstance(interview_plan.get("questions"), list) else []
    output: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            continue
        output.append(
            {
                "id": f"agent-{index}",
                "dimension": "technical_depth",
                "difficulty": "medium",
                "prompt": normalize_text(question.get("rendered_text")) or normalize_text(question.get("question_text")),
                "expected_signals": question.get("expected_key_points") if isinstance(question.get("expected_key_points"), list) else [],
                "topic": normalize_text(question.get("topic")),
                "answer_guidance": normalize_text(question.get("answer_guidance")),
            }
        )
    return output


class Database:
    def __init__(self) -> None:
        self.client: Client | None = None

    def get_client(self, user_token: str | None = None) -> Client:
        base_url = os.getenv("SUPABASE_URL") or env("VITE_SUPABASE_URL")
        if user_token:
            anon_key = normalize_text(os.getenv("SUPABASE_ANON_KEY")) or env("VITE_SUPABASE_ANON_KEY")
            client = create_client(base_url, anon_key)
            client.postgrest.auth(user_token)
            return client

        service_role_key = normalize_text(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        if service_role_key:
            if self.client is None:
                self.client = create_client(base_url, service_role_key)
            return self.client

        anon_key = normalize_text(os.getenv("SUPABASE_ANON_KEY")) or env("VITE_SUPABASE_ANON_KEY")
        client = create_client(base_url, anon_key)
        return client

    @staticmethod
    def first(response: Any) -> dict[str, Any] | None:
        data = getattr(response, "data", None) or []
        if isinstance(data, list):
            return data[0] if data else None
        return data if isinstance(data, dict) else None

    @staticmethod
    def many(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None) or []
        return data if isinstance(data, list) else []


db = Database()


def is_rule_only_historical_match(match: dict[str, Any]) -> bool:
    return normalize_text(match.get("model_version")) == "historical-rule-only" or normalize_text(match.get("pipeline_version")) == "phase1-historical-rescreen-rule-only"


def build_screening_candidates(client: Client, position_id: str) -> list[dict[str, Any]]:
    match_rows = db.many(
        client.table("candidate_position_matches")
        .select("id,candidate_id,position_id,overall_score,recommendation,summary_reason,human_decision,review_note,reviewed_at,model_version,pipeline_version,created_at")
        .eq("position_id", position_id)
        .order("created_at", desc=True)
        .execute()
    )

    if not match_rows:
        return []

    latest_match_by_candidate: dict[str, dict[str, Any]] = {}
    for row in match_rows:
        candidate_id = normalize_text(row.get("candidate_id"))
        if not candidate_id:
            continue
        existing = latest_match_by_candidate.get(candidate_id)
        if existing is None:
            latest_match_by_candidate[candidate_id] = row
            continue
        if is_rule_only_historical_match(existing) and not is_rule_only_historical_match(row):
            latest_match_by_candidate[candidate_id] = row

    candidate_ids = [item for item in latest_match_by_candidate.keys() if item]
    if not candidate_ids:
        return []

    candidate_rows = db.many(
        client.table("candidates")
        .select("id,name,title,exp_years,edu_level,age,prev_company,tag,highlight")
        .in_("id", candidate_ids)
        .execute()
    )
    candidate_map = {normalize_text(row.get("id")): row for row in candidate_rows if normalize_text(row.get("id"))}

    merged_candidates: list[dict[str, Any]] = []
    for match_row in latest_match_by_candidate.values():
        base = candidate_map.get(normalize_text(match_row.get("candidate_id")))
        if not base:
            continue
        merged_candidates.append(
            {
                "id": base.get("id"),
                "match_id": match_row.get("id"),
                "position_id": match_row.get("position_id"),
                "match_created_at": match_row.get("created_at"),
                "name": base.get("name"),
                "title": base.get("title"),
                "exp_years": base.get("exp_years"),
                "edu_level": base.get("edu_level"),
                "age": base.get("age"),
                "match": match_row.get("overall_score"),
                "recommendation": match_row.get("recommendation"),
                "prev_company": base.get("prev_company"),
                "tag": base.get("tag"),
                "highlight": match_row.get("summary_reason") or base.get("highlight"),
                "human_decision": match_row.get("human_decision"),
                "review_note": match_row.get("review_note"),
                "reviewed_at": match_row.get("reviewed_at"),
            }
        )

    return merged_candidates


def pick_preferred_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not matches:
        return None
    for item in matches:
        if not is_rule_only_historical_match(item):
            return item
    return matches[0]


def load_match_weights(client: Client) -> dict[str, float]:
    defaults = {
        "must_have": 35.0,
        "skills": 25.0,
        "project": 20.0,
        "experience": 15.0,
        "education": 5.0,
    }
    settings = db.first(
        client.table("company_settings")
        .select("match_weight_must_have,match_weight_skills,match_weight_project,match_weight_experience,match_weight_education")
        .limit(1)
        .execute()
    )
    if not settings:
        return defaults
    weights = {
        "must_have": to_number(settings.get("match_weight_must_have"), defaults["must_have"]),
        "skills": to_number(settings.get("match_weight_skills"), defaults["skills"]),
        "project": to_number(settings.get("match_weight_project"), defaults["project"]),
        "experience": to_number(settings.get("match_weight_experience"), defaults["experience"]),
        "education": to_number(settings.get("match_weight_education"), defaults["education"]),
    }
    total = sum(weights.values())
    return weights if total > 0 else defaults


def build_job_requirement_from_position(position: dict[str, Any]) -> dict[str, Any]:
    source_text = " ".join(part for part in [normalize_text(position.get("title")), normalize_text(position.get("technical_requirements"))] if part)
    detected_skills = dedupe_keep_order([normalize_skill(item) for item in split_skills(source_text)])
    clauses = [
        item.strip()
        for item in normalize_text(position.get("technical_requirements")).replace("；", ";").replace("。", ";").split(";")
        if item and len(item.strip()) >= 4
    ][:6]
    return {
        "position_title": normalize_text(position.get("title")),
        "must_have_skills": [{"skill": skill, "min_level": "independent", "min_years": None} for skill in detected_skills[:6]],
        "nice_to_have_skills": [],
        "required_experience_years": position.get("min_exp"),
        "education_requirement": {
            "min_level": position.get("min_edu"),
            "is_strict": True,
        },
        "industry_preference": [],
        "project_keywords": detected_skills[:8],
        "seniority_level": "staff_plus" if to_number(position.get("min_exp"), 0) >= 8 else ("senior" if to_number(position.get("min_exp"), 0) >= 5 else "mid"),
        "core_responsibilities": clauses,
    }


def create_job_requirement_snapshot(client: Client, position: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    payload = build_job_requirement_from_position(position)
    versions = db.many(
        client.table("parsed_job_requirements")
        .select("version_no")
        .eq("position_id", position["id"])
        .order("version_no", desc=True)
        .limit(1)
        .execute()
    )
    next_version_no = int(versions[0].get("version_no") or 0) + 1 if versions else 1
    inserted = db.first(
        client.table("parsed_job_requirements")
        .insert(
            [
                {
                    "position_id": position["id"],
                    "version_no": next_version_no,
                    "is_active": False,
                    "position_title": payload["position_title"],
                    "must_have_skills": payload["must_have_skills"],
                    "nice_to_have_skills": payload["nice_to_have_skills"],
                    "required_experience_years": payload["required_experience_years"],
                    "education_requirement": payload["education_requirement"],
                    "industry_preference": payload["industry_preference"],
                    "project_keywords": payload["project_keywords"],
                    "seniority_level": payload["seniority_level"],
                    "core_responsibilities": payload["core_responsibilities"],
                    "source_text": position.get("technical_requirements"),
                    "prompt_version": "phase1-job-v1",
                    "model_version": "rule-based-bootstrap",
                    "pipeline_version": "phase1",
                }
            ]
        )
        .execute()
    )
    if not inserted or not inserted.get("id"):
        raise HTTPException(status_code=500, detail="创建岗位要求快照失败")
    return str(inserted["id"]), payload


def build_match_output(profile: dict[str, Any], requirement: dict[str, Any], weight_config: dict[str, float]) -> dict[str, Any]:
    explicit_skills = [normalize_skill(item.get("skill")) for item in profile.get("explicit_skills", []) if isinstance(item, dict)]
    inferred_skills = [normalize_skill(item.get("skill")) for item in profile.get("inferred_skills", []) if isinstance(item, dict)]
    candidate_skills = dedupe_keep_order([*explicit_skills, *inferred_skills])

    must_have_skills = [normalize_skill(item.get("skill")) for item in requirement.get("must_have_skills", []) if isinstance(item, dict)]
    nice_skills = [normalize_skill(item.get("skill")) for item in requirement.get("nice_to_have_skills", []) if isinstance(item, dict)]
    all_required_skills = dedupe_keep_order([*must_have_skills, *nice_skills])

    missing_skills = [item for item in must_have_skills if item and item not in candidate_skills]
    matched_skills = [item for item in all_required_skills if item and item in candidate_skills]

    must_have_breakdown = [
        {
            "requirement": f"must_have:{skill}",
            "status": "met" if skill in candidate_skills else "not_met",
            "reason": "候选人技能中命中" if skill in candidate_skills else "未识别到直接证据",
        }
        for skill in must_have_skills
    ]
    must_have_score = 70 if not must_have_breakdown else round(sum(1 for item in must_have_breakdown if item["status"] == "met") / len(must_have_breakdown) * 100)
    skill_score = 70 if not all_required_skills else round(len(matched_skills) / max(1, len(all_required_skills)) * 100)

    keyword_set = set(dedupe_keep_order([*requirement.get("project_keywords", []), *must_have_skills]))
    project_scores: list[dict[str, Any]] = []
    for project in profile.get("projects", []):
        if not isinstance(project, dict):
            continue
        summary_tokens = split_skills(normalize_text(project.get("project_summary")))
        tech_stack = [normalize_skill(item) for item in (project.get("tech_stack") or []) if isinstance(item, str)]
        project_tokens = set(dedupe_keep_order([*tech_stack, *summary_tokens]))
        hit = len([token for token in keyword_set if token in project_tokens])
        denom = max(1, len(keyword_set))
        relevance_score = min(100, round(hit / denom * 100) + (10 if normalize_text(project.get("complexity_level")) == "high" else 0))
        project_scores.append(
            {
                "project_name": normalize_text(project.get("project_name")) or "未命名项目",
                "relevance_score": relevance_score,
                "evidence_span_ids": project.get("evidence_spans") if isinstance(project.get("evidence_spans"), list) else [],
            }
        )
    matched_projects = sorted(project_scores, key=lambda item: item["relevance_score"], reverse=True)[:3]
    project_relevance_score = 45 if not matched_projects else round(sum(item["relevance_score"] for item in matched_projects) / len(matched_projects))

    requirement_breakdown = list(must_have_breakdown)
    required_years = requirement.get("required_experience_years")
    basic_profile = profile.get("basic_profile") if isinstance(profile.get("basic_profile"), dict) else {}
    years = basic_profile.get("years_of_experience")
    experience_score = 70
    if required_years is None:
        requirement_breakdown.append({"requirement": "experience_years", "status": "unknown", "reason": "岗位未设置经验年限"})
    elif years is None:
        experience_score = 50
        requirement_breakdown.append({"requirement": f"experience_years>={required_years}", "status": "unknown", "reason": "候选人经验年限缺失"})
    elif to_number(years) >= to_number(required_years):
        experience_score = min(100, round(80 + (to_number(years) - to_number(required_years)) * 4))
        requirement_breakdown.append({"requirement": f"experience_years>={required_years}", "status": "met", "reason": f"候选人经验 {years} 年"})
    else:
        experience_score = max(20, round(to_number(years) / max(to_number(required_years), 1) * 100))
        requirement_breakdown.append({"requirement": f"experience_years>={required_years}", "status": "not_met", "reason": f"候选人经验 {years} 年"})

    required_edu_level = normalize_text((requirement.get("education_requirement") or {}).get("min_level") if isinstance(requirement.get("education_requirement"), dict) else None)
    education = profile.get("education") if isinstance(profile.get("education"), list) else []
    first_education = education[0] if education and isinstance(education[0], dict) else {}
    candidate_edu_level = normalize_text(first_education.get("degree"))
    education_score = 70
    if not required_edu_level:
        requirement_breakdown.append({"requirement": "education_requirement", "status": "unknown", "reason": "岗位未设置学历要求"})
    elif not candidate_edu_level:
        education_score = 55
        requirement_breakdown.append({"requirement": f"education>={required_edu_level}", "status": "unknown", "reason": "候选人学历信息缺失"})
    elif education_rank(candidate_edu_level) >= education_rank(required_edu_level):
        education_score = 95
        requirement_breakdown.append({"requirement": f"education>={required_edu_level}", "status": "met", "reason": f"候选人学历 {candidate_edu_level}"})
    else:
        education_score = 30
        requirement_breakdown.append({"requirement": f"education>={required_edu_level}", "status": "not_met", "reason": f"候选人学历 {candidate_edu_level}"})

    total_weight = max(1.0, sum(weight_config.values()))
    overall_score = round(
        (
            must_have_score * weight_config["must_have"]
            + skill_score * weight_config["skills"]
            + project_relevance_score * weight_config["project"]
            + experience_score * weight_config["experience"]
            + education_score * weight_config["education"]
        )
        / total_weight
    )

    risk_flags = profile.get("risk_flags") if isinstance(profile.get("risk_flags"), list) else []
    concerns = dedupe_keep_order(
        [
            *( [f"缺少关键技能: {', '.join(missing_skills[:3])}"] if missing_skills else [] ),
            *[normalize_text(item.get("message")) for item in risk_flags if isinstance(item, dict) and normalize_text(item.get("message"))],
            *(["存在信息缺失项，建议补充后自动重试"] if any(item["status"] == "unknown" for item in requirement_breakdown) else []),
        ]
    )
    summary_reason = (
        f"核心技能匹配度较高，最相关项目为 {matched_projects[0]['project_name'] if matched_projects else '暂无'}。"
        if not missing_skills
        else f"具备部分岗位能力，但缺少 {'、'.join(missing_skills[:2])} 等关键项。"
    )
    evidence_links = dedupe_keep_order(
        [
            *[item for project in matched_projects for item in (project.get("evidence_span_ids") or []) if isinstance(item, str)],
            *[
                evidence_span
                for item in profile.get("explicit_skills", [])
                if isinstance(item, dict)
                for evidence_span in ((item.get("evidence_span_ids") or [])[:1] if isinstance(item.get("evidence_span_ids"), list) else [])
                if isinstance(evidence_span, str)
            ],
        ]
    )[:12]

    extraction_confidence = profile.get("extraction_confidence") if isinstance(profile.get("extraction_confidence"), dict) else {}
    overall_confidence = to_number(extraction_confidence.get("overall"), 0.6)
    return {
        "overall_score": overall_score,
        "recommendation": score_to_recommendation(overall_score),
        "must_have_match_score": must_have_score,
        "skill_match_score": skill_score,
        "project_relevance_score": project_relevance_score,
        "experience_match_score": experience_score,
        "education_match_score": education_score,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "matched_projects": matched_projects,
        "concerns": concerns,
        "summary_reason": summary_reason,
        "confidence": max(0.0, min(1.0, overall_confidence)),
        "evidence_links": evidence_links,
        "requirement_breakdown": requirement_breakdown,
    }


def get_auth_headers(token: str | None) -> dict[str, str]:
    headers = {"apikey": os.getenv("SUPABASE_ANON_KEY") or env("VITE_SUPABASE_ANON_KEY")}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def get_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


def require_user(authorization: str | None) -> dict[str, Any]:
    token = get_bearer_token(authorization)

    base_url = os.getenv("SUPABASE_URL") or env("VITE_SUPABASE_URL")
    response = httpx.get(
        f"{base_url}/auth/v1/user",
        headers=get_auth_headers(token),
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Unauthorized")
    payload = response.json()
    if not isinstance(payload, dict) or not payload.get("id"):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return payload


def is_missing_table_error(error: Exception, table_names: tuple[str, ...]) -> bool:
    message = str(error)
    return any(table_name in message for table_name in table_names) and (
        "Could not find the table" in message or "does not exist" in message
    )


def normalize_agent_runtime_response(raw: dict[str, Any]) -> dict[str, Any]:
    response = raw.get("response") if isinstance(raw.get("response"), dict) else None
    if response is not None:
        merged = dict(response)
        if "state_snapshot" in raw and "state_snapshot" not in merged:
            merged["state_snapshot"] = raw.get("state_snapshot")
        return merged
    return raw


def is_agent_session_exists_response(raw: dict[str, Any]) -> bool:
    message = normalize_text(raw.get("message")).lower()
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    metadata_error = normalize_text(metadata.get("error")).lower()
    status = normalize_text(raw.get("status")).lower()
    return status == "error" and (
        "session already exists" in message or "session already exists" in metadata_error
    )


def is_agent_system_error_message(content: Any) -> bool:
    text = normalize_text(content).lower()
    return (
        "session already exists" in text
        or "agent gateway request failed" in text
        or "session not found" in text
        or "not waiting for a candidate answer" in text
    )


def resolve_configured_interview_question_count(client: Any, fallback: int | None = None) -> int | None:
    settings = db.first(
        client.table("company_settings")
        .select("interview_question_count")
        .limit(1)
        .execute()
    )
    raw_value = settings.get("interview_question_count") if settings else fallback
    try:
        count = int(raw_value)
    except (TypeError, ValueError):
        return fallback
    return count if count > 0 else fallback


def require_super_admin_user(authorization: str | None) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    role_row = db.first(client.table("user_roles").select("role").eq("id", user["id"]).limit(1).execute()) or {}
    role = normalize_text(role_row.get("role"))
    if role not in {"owner", "super_admin"}:
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


def agent_fetch(path: str, payload: dict[str, Any] | None = None, method: str = "POST") -> dict[str, Any]:
    base_url = env("AGENT_BASE_URL").rstrip("/")
    headers = {"Content-Type": "application/json"}
    shared_secret = os.getenv("AGENT_SHARED_SECRET", "").strip()
    if shared_secret:
        headers["x-agent-secret"] = shared_secret
    timeout = float(os.getenv("AGENT_TIMEOUT_MS", "20000")) / 1000
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        response = client.request(method, f"{base_url}{path}", headers=headers, json=payload)
    if response.status_code >= 400:
        detail = ""
        try:
            raw = response.json()
            if isinstance(raw, dict):
                detail = normalize_text(raw.get("detail")) or normalize_text(raw.get("error"))
        except Exception:
            detail = normalize_text(response.text)
        raise HTTPException(status_code=response.status_code or 502, detail=detail or "Agent gateway request failed")
    try:
        return response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Agent gateway returned invalid JSON: {exc}") from exc


def next_turn_no(session_id: str) -> int:
    client = db.get_client()
    rows = db.many(
        client.table("interview_turns")
        .select("turn_no")
        .eq("session_id", session_id)
        .order("turn_no", desc=True)
        .limit(1)
        .execute()
    )
    latest = rows[0]["turn_no"] if rows else 0
    return int(latest) + 1


def _salary_text(value: Any) -> str:
    return normalize_text(value).casefold()


def _parse_salary_amount(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = _salary_text(value).replace(",", "")
    if not text:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kKwW万]?)(?:\b|$)", text)
    if not match:
        return None
    amount = float(match.group(1))
    suffix = match.group(2).lower()
    if suffix == "k":
        amount *= 1000.0
    elif suffix in {"w", "万"}:
        amount *= 10000.0
    return amount


def _salary_period_multiplier(period: Any) -> float | None:
    text = _salary_text(period)
    if not text or text in {"unknown", "n/a"}:
        return 1.0
    if any(token in text for token in {"month", "monthly", "/mo", "/month", "mo", "月"}):
        return 1.0
    if any(token in text for token in {"year", "annual", "annually", "/yr", "/year", "yr", "年"}):
        return 1.0 / 12.0
    if any(token in text for token in {"week", "weekly", "/wk", "/week", "wk", "周"}):
        return 52.0 / 12.0
    if any(token in text for token in {"day", "daily", "/day", "日"}):
        return 21.75
    if any(token in text for token in {"hour", "hourly", "/hr", "/hour", "时"}):
        return 21.75 * 8.0
    return None


def _infer_market_salary_role(title: Any) -> str:
    text = _salary_text(title)
    if not text:
        return "unknown"
    if any(token in text for token in {"computer vision", "cv algorithm", "cv engineer", "vision algorithm", "视觉算法", "计算机视觉"}):
        return "cv_algorithm_engineer"
    if any(token in text for token in {"recommendation algorithm", "algorithm engineer", "machine learning algorithm", "算法工程师"}):
        return "algorithm_engineer"
    if any(token in text for token in {"data scientist", "data science", "数据科学"}):
        return "data_scientist"
    if any(token in text for token in {"backend engineer", "backend developer", "server engineer", "后端工程师"}):
        return "backend_engineer"
    return "unknown"


def _infer_market_salary_city(city: Any) -> str:
    text = _salary_text(city)
    if not text:
        return "unknown"
    if any(token in text for token in {"beijing", "北京", "北京"}):
        return "beijing"
    if any(token in text for token in {"shanghai", "上海"}):
        return "shanghai"
    if any(token in text for token in {"shenzhen", "深圳"}):
        return "shenzhen"
    if any(token in text for token in {"hangzhou", "杭州"}):
        return "hangzhou"
    if any(token in text for token in {"guangzhou", "广州"}):
        return "guangzhou"
    return "unknown"


def _infer_market_salary_level(experience_text: Any) -> str:
    text = _salary_text(experience_text)
    if not text:
        return "unknown"
    if any(token in text for token in {"3-5", "3 to 5", "3-5 years", "3 to 5 years", "3年5年", "3年-5年"}):
        return "mid"
    if any(token in text for token in {"5-8", "5 to 8", "5-8 years", "5 to 8 years", "5年8年", "5年-8年"}):
        return "senior"
    if any(token in text for token in {"0-3", "1-3", "0 to 3", "0-3 years", "1-3 years", "0年3年", "1年3年"}):
        return "junior"
    if any(token in text for token in {"lead", "principal", "staff", "expert", "8+", "10+", "8 years", "10 years", "8年", "10年", "资深", "专家", "负责人"}):
        return "lead"
    if any(token in text for token in {"senior", "5 years", "5年", "高级"}):
        return "senior"
    if any(token in text for token in {"mid", "3 years", "3年", "中级"}):
        return "mid"
    if any(token in text for token in {"junior", "应届", "初级"}):
        return "junior"
    return "unknown"


def normalize_market_salary_record(raw: dict[str, Any]) -> dict[str, Any]:
    source_job_title = normalize_text(raw.get("source_job_title")) or normalize_text(raw.get("job_title"))
    source_city = normalize_text(raw.get("source_city")) or normalize_text(raw.get("city"))
    source_salary_text = normalize_text(raw.get("source_salary_text")) or normalize_text(raw.get("salary_text"))
    salary_period = normalize_text(raw.get("salary_period")) or "monthly"
    salary_min = _parse_salary_amount(raw.get("salary_min"))
    salary_max = _parse_salary_amount(raw.get("salary_max"))

    if salary_min is None or salary_max is None:
        parsed_range = re.findall(r"(\d+(?:\.\d+)?)\s*([kKwW万]?)", _salary_text(source_salary_text))
        if len(parsed_range) >= 2:
            salary_min = _parse_salary_amount("".join(parsed_range[0])) or salary_min
            salary_max = _parse_salary_amount("".join(parsed_range[1])) or salary_max

    role_key = _infer_market_salary_role(source_job_title)
    city_key = _infer_market_salary_city(source_city)
    level_key = _infer_market_salary_level(raw.get("experience_text"))
    source_key = normalize_text(raw.get("source"))
    captured_at = normalize_text(raw.get("captured_at")) or now_iso()
    multiplier = _salary_period_multiplier(salary_period)

    if salary_min is None or salary_max is None:
        return {
            "source": source_key,
            "source_job_title": source_job_title,
            "source_city": source_city,
            "source_salary_text": source_salary_text,
            "normalized_role": role_key,
            "normalized_city": city_key,
            "normalized_level": level_key,
            "salary_min_monthly": None,
            "salary_median_monthly": None,
            "salary_max_monthly": None,
            "captured_at": captured_at,
            "is_valid": False,
            "invalid_reason": "missing_salary_range",
        }

    if multiplier is None:
        return {
            "source": source_key,
            "source_job_title": source_job_title,
            "source_city": source_city,
            "source_salary_text": source_salary_text,
            "normalized_role": role_key,
            "normalized_city": city_key,
            "normalized_level": level_key,
            "salary_min_monthly": None,
            "salary_median_monthly": None,
            "salary_max_monthly": None,
            "captured_at": captured_at,
            "is_valid": False,
            "invalid_reason": "unsupported_salary_period",
        }

    monthly_min = int(round(salary_min * multiplier))
    monthly_max = int(round(salary_max * multiplier))
    if monthly_max < monthly_min:
        monthly_min, monthly_max = monthly_max, monthly_min
    normalized_level = level_key
    invalid_reason = None
    if role_key == "unknown":
        invalid_reason = "unknown_role"
    elif city_key == "unknown":
        invalid_reason = "unknown_city"
    elif normalized_level == "unknown":
        invalid_reason = "unknown_level"

    return {
        "source": source_key,
        "source_job_title": source_job_title,
        "source_city": source_city,
        "source_salary_text": source_salary_text,
        "normalized_role": role_key,
        "normalized_city": city_key,
        "normalized_level": normalized_level,
        "salary_min_monthly": monthly_min,
        "salary_median_monthly": int(round((monthly_min + monthly_max) / 2.0)),
        "salary_max_monthly": monthly_max,
        "captured_at": captured_at,
        "is_valid": invalid_reason is None,
        "invalid_reason": invalid_reason,
    }


def build_market_salary_benchmarks(records: list[dict[str, Any]], min_samples: int = 2) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for record in records:
        if not isinstance(record, dict) or not record.get("is_valid"):
            continue
        role_key = normalize_text(record.get("normalized_role")) or "unknown"
        city_key = normalize_text(record.get("normalized_city")) or "unknown"
        level_key = normalize_text(record.get("normalized_level")) or "unknown"
        if "unknown" in {role_key, city_key, level_key}:
            continue
        grouped.setdefault((role_key, city_key, level_key), []).append(record)

    benchmarks: list[dict[str, Any]] = []
    for (role_key, city_key, level_key), items in grouped.items():
        if len(items) < min_samples:
            continue
        min_salary = int(round(sum(to_number(item.get("salary_min_monthly")) for item in items) / len(items)))
        median_salary = int(round(sum(to_number(item.get("salary_median_monthly")) for item in items) / len(items)))
        max_salary = int(round(sum(to_number(item.get("salary_max_monthly")) for item in items) / len(items)))
        latest_source_at = max((normalize_text(item.get("captured_at")) for item in items), default="")
        benchmarks.append(
            {
                "role_key": role_key,
                "city_key": city_key,
                "level_key": level_key,
                "min_salary": min_salary,
                "median_salary": median_salary,
                "max_salary": max_salary,
                "sample_size": len(items),
                "source_count": len({normalize_text(item.get("source")) for item in items if normalize_text(item.get("source"))}),
                "latest_source_at": latest_source_at or None,
                "updated_at": now_iso(),
            }
        )

    benchmarks.sort(key=lambda item: (item["sample_size"], item["median_salary"], item["role_key"], item["city_key"], item["level_key"]), reverse=True)
    return benchmarks


def _market_salary_hash_key(row: dict[str, Any]) -> str:
    payload = {
        "source": normalize_text(row.get("source")),
        "source_job_title": normalize_text(row.get("source_job_title")),
        "source_city": normalize_text(row.get("source_city")),
        "source_salary_text": normalize_text(row.get("source_salary_text")),
        "salary_min": to_number(row.get("salary_min"), 0.0),
        "salary_max": to_number(row.get("salary_max"), 0.0),
        "salary_period": normalize_text(row.get("salary_period")),
        "currency": normalize_text(row.get("currency")),
        "experience_text": normalize_text(row.get("experience_text")),
        "education_text": normalize_text(row.get("education_text")),
        "company_name": normalize_text(row.get("company_name")),
        "captured_at": normalize_text(row.get("captured_at")),
        "raw_payload": row.get("raw_payload") if isinstance(row.get("raw_payload"), dict) else {},
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _build_market_salary_raw_row(source: str, record: dict[str, Any]) -> dict[str, Any]:
    source_job_title = normalize_text(record.get("source_job_title")) or normalize_text(record.get("job_title"))
    if not source_job_title:
        raise HTTPException(status_code=400, detail="source_job_title is required")

    captured_at = normalize_text(record.get("captured_at")) or now_iso()
    raw_payload = record.get("raw_payload") if isinstance(record.get("raw_payload"), dict) else {
        key: value
        for key, value in record.items()
        if key != "raw_payload"
    }
    return {
        "source": normalize_text(source) or normalize_text(record.get("source")) or "unknown",
        "source_job_title": source_job_title,
        "source_city": normalize_text(record.get("source_city")) or normalize_text(record.get("city")) or None,
        "source_salary_text": normalize_text(record.get("source_salary_text")) or normalize_text(record.get("salary_text")) or "",
        "salary_min": _parse_salary_amount(record.get("salary_min")),
        "salary_max": _parse_salary_amount(record.get("salary_max")),
        "salary_period": normalize_text(record.get("salary_period")) or "monthly",
        "currency": normalize_text(record.get("currency")) or "CNY",
        "experience_text": normalize_text(record.get("experience_text")) or None,
        "education_text": normalize_text(record.get("education_text")) or None,
        "company_name": normalize_text(record.get("company_name")) or None,
        "captured_at": captured_at,
        "raw_payload": raw_payload,
        "hash_key": _market_salary_hash_key(
            {
                "source": normalize_text(source) or normalize_text(record.get("source")) or "unknown",
                "source_job_title": source_job_title,
                "source_city": normalize_text(record.get("source_city")) or normalize_text(record.get("city")) or None,
                "source_salary_text": normalize_text(record.get("source_salary_text")) or normalize_text(record.get("salary_text")) or "",
                "salary_min": _parse_salary_amount(record.get("salary_min")),
                "salary_max": _parse_salary_amount(record.get("salary_max")),
                "salary_period": normalize_text(record.get("salary_period")) or "monthly",
                "currency": normalize_text(record.get("currency")) or "CNY",
                "experience_text": normalize_text(record.get("experience_text")) or None,
                "education_text": normalize_text(record.get("education_text")) or None,
                "company_name": normalize_text(record.get("company_name")) or None,
                "captured_at": captured_at,
                "raw_payload": raw_payload,
            }
        ),
    }


def ingest_market_salary_records(client: Client, source: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        raise HTTPException(status_code=400, detail="records is required")

    raw_rows = [_build_market_salary_raw_row(source, record) for record in records]
    hash_keys = [row["hash_key"] for row in raw_rows]
    client.table("market_salary_raw_records").upsert(raw_rows, on_conflict="hash_key").execute()
    persisted_raw_rows = db.many(
        client.table("market_salary_raw_records")
        .select("*")
        .in_("hash_key", hash_keys)
        .execute()
    )

    normalized_rows = []
    for raw_row in persisted_raw_rows:
        normalized = normalize_market_salary_record(raw_row)
        normalized_rows.append(
            {
                "raw_record_id": raw_row.get("id"),
                "normalized_role": normalized.get("normalized_role"),
                "normalized_city": normalized.get("normalized_city"),
                "normalized_level": normalized.get("normalized_level"),
                "salary_min_monthly": normalized.get("salary_min_monthly"),
                "salary_median_monthly": normalized.get("salary_median_monthly"),
                "salary_max_monthly": normalized.get("salary_max_monthly"),
                "source": normalized.get("source"),
                "captured_at": normalized.get("captured_at"),
                "is_valid": normalized.get("is_valid"),
                "invalid_reason": normalized.get("invalid_reason"),
            }
        )

    if normalized_rows:
        client.table("market_salary_normalized_records").upsert(normalized_rows, on_conflict="raw_record_id").execute()

    return {
        "source": normalize_text(source) or "unknown",
        "raw_inserted": len(raw_rows),
        "normalized_written": len(normalized_rows),
        "normalized_valid": sum(1 for row in normalized_rows if row.get("is_valid")),
        "normalized_invalid": sum(1 for row in normalized_rows if not row.get("is_valid")),
    }


def refresh_market_salary_benchmarks(client: Client, min_samples: int = 2) -> dict[str, Any]:
    normalized_rows = db.many(
        client.table("market_salary_normalized_records")
        .select("*")
        .order("captured_at", desc=True)
        .execute()
    )
    benchmark_rows = build_market_salary_benchmarks(normalized_rows, min_samples=min_samples)
    benchmark_keys = {
        _salary_benchmark_key(row["role_key"], row["city_key"], row["level_key"])
        for row in benchmark_rows
    }
    existing_rows = db.many(
        client.table("market_salary_benchmarks")
        .select("id,role_key,city_key,level_key")
        .execute()
    )
    deleted_benchmark_ids: list[str] = []
    for row in existing_rows:
        row_id = normalize_text(row.get("id"))
        if not row_id:
            continue
        if _salary_benchmark_key(row.get("role_key"), row.get("city_key"), row.get("level_key")) not in benchmark_keys:
            client.table("market_salary_benchmarks").delete().eq("id", row_id).execute()
            deleted_benchmark_ids.append(row_id)
    if benchmark_rows:
        client.table("market_salary_benchmarks").upsert(benchmark_rows, on_conflict="role_key,city_key,level_key").execute()

    persisted_benchmarks = db.many(
        client.table("market_salary_benchmarks")
        .select("*")
        .order("updated_at", desc=True)
        .execute()
    )
    return {
        "normalized_records": len(normalized_rows),
        "benchmark_count": len(persisted_benchmarks),
        "deleted_benchmark_count": len(deleted_benchmark_ids),
        "upserted_benchmark_count": len(benchmark_rows),
        "benchmarks": persisted_benchmarks,
    }


def build_salary_dashboard_payload(benchmarks: list[dict[str, Any]], crawl_jobs: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {
        "benchmark_count": len(benchmarks),
        "crawl_job_count": len(crawl_jobs),
        "pending_crawl_jobs": sum(1 for item in crawl_jobs if normalize_text(item.get("status")).lower() == "pending"),
        "running_crawl_jobs": sum(1 for item in crawl_jobs if normalize_text(item.get("status")).lower() == "running"),
        "successful_crawl_jobs": sum(1 for item in crawl_jobs if normalize_text(item.get("status")).lower() in {"success", "succeeded", "done"}),
        "failed_crawl_jobs": sum(1 for item in crawl_jobs if normalize_text(item.get("status")).lower() in {"failed", "error"}),
        "latest_crawl_status": normalize_text(crawl_jobs[0].get("status")) if crawl_jobs else "unknown",
    }
    return {
        "summary": summary,
        "benchmarks": benchmarks,
        "crawl_jobs": crawl_jobs[:10],
    }


def normalize_offer_status(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    return re.sub(r"[\s\-]+", "_", text.casefold())


def _estimate_salary_level_from_position(position: dict[str, Any]) -> str:
    min_exp = to_number(position.get("min_exp"), -1)
    if min_exp < 0:
        return "unknown"
    if min_exp >= 8:
        return "lead"
    if min_exp >= 5:
        return "senior"
    if min_exp >= 3:
        return "mid"
    return "junior"


def _salary_benchmark_key(role_key: Any, city_key: Any, level_key: Any) -> str:
    return "|".join(
        [
            normalize_text(role_key) or "unknown",
            normalize_text(city_key) or "unknown",
            normalize_text(level_key) or "unknown",
        ]
    )


def _pretty_dimension_label(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return "Unknown"
    return text.replace("_", " ").title()


def _pick_fields(row: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {field: row.get(field) for field in fields if field in row}


def _build_salary_benchmark_card(row: dict[str, Any]) -> dict[str, Any]:
    role_key = normalize_text(row.get("role_key")) or "unknown"
    city_key = normalize_text(row.get("city_key")) or "unknown"
    level_key = normalize_text(row.get("level_key")) or "unknown"
    return {
        "key": _salary_benchmark_key(role_key, city_key, level_key),
        "role_key": role_key,
        "city_key": city_key,
        "level_key": level_key,
        "label": " / ".join(
            [
                _pretty_dimension_label(role_key),
                _pretty_dimension_label(city_key),
                _pretty_dimension_label(level_key),
            ]
        ),
        "min_salary": int(round(to_number(row.get("min_salary")))),
        "median_salary": int(round(to_number(row.get("median_salary")))),
        "max_salary": int(round(to_number(row.get("max_salary")))),
        "sample_size": int(round(to_number(row.get("sample_size")))),
        "source_count": int(round(to_number(row.get("source_count")))),
        "latest_source_at": normalize_text(row.get("latest_source_at")) or None,
        "updated_at": normalize_text(row.get("updated_at")) or None,
    }


def _find_salary_benchmark(
    benchmark_lookup: dict[str, dict[str, Any]],
    role_key: str,
    city_key: str,
    level_key: str,
) -> tuple[dict[str, Any] | None, str]:
    search_order = [
        (role_key, city_key, level_key),
        (role_key, city_key, "unknown"),
        (role_key, "unknown", level_key),
        ("unknown", city_key, level_key),
        (role_key, "unknown", "unknown"),
        ("unknown", city_key, "unknown"),
        ("unknown", "unknown", level_key),
        ("unknown", "unknown", "unknown"),
    ]
    for index, (role, city, level) in enumerate(search_order):
        benchmark = benchmark_lookup.get(_salary_benchmark_key(role, city, level))
        if benchmark:
            return benchmark, "exact" if index == 0 else "fallback"
    return None, "none"


def _build_salary_profile_card(
    profile: dict[str, Any],
    candidate_lookup: dict[str, dict[str, Any]],
    position_lookup: dict[str, dict[str, Any]],
    benchmark_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    candidate_id = normalize_text(profile.get("candidate_id"))
    position_id = normalize_text(profile.get("position_id"))
    candidate = candidate_lookup.get(candidate_id) if candidate_id else None
    position = position_lookup.get(position_id) if position_id else None
    candidate_card = _pick_fields(
        candidate or {},
        ["id", "name", "title", "department", "location", "edu", "exp", "prev_company", "highlight"],
    ) if candidate else None
    position_card = _pick_fields(
        position or {},
        ["id", "title", "department", "location", "status", "min_exp", "min_edu"],
    ) if position else None
    role_key = _infer_market_salary_role((position or candidate or {}).get("title"))
    city_key = _infer_market_salary_city((position or candidate or {}).get("location"))
    level_key = _estimate_salary_level_from_position(position or {})
    benchmark_card, match_type = _find_salary_benchmark(benchmark_lookup, role_key, city_key, level_key)
    benchmark_output = dict(benchmark_card) if benchmark_card else None
    if benchmark_output is not None:
        benchmark_output["match_type"] = match_type

    offer_salary_raw = profile.get("offer_salary")
    offer_salary = to_number(offer_salary_raw) if offer_salary_raw is not None else None
    market_position = "unknown"
    offer_vs_market = {
        "delta_to_min": None,
        "delta_to_median": None,
        "delta_to_max": None,
        "position": "unknown",
    }
    if benchmark_output and offer_salary is not None:
        min_salary = to_number(benchmark_output.get("min_salary"))
        median_salary = to_number(benchmark_output.get("median_salary"))
        max_salary = to_number(benchmark_output.get("max_salary"))
        offer_vs_market = {
            "delta_to_min": int(round(offer_salary - min_salary)),
            "delta_to_median": int(round(offer_salary - median_salary)),
            "delta_to_max": int(round(offer_salary - max_salary)),
            "position": "below_market" if offer_salary < min_salary else "above_market" if offer_salary > max_salary else "within_market",
        }
        market_position = offer_vs_market["position"]

    return {
        "id": profile.get("id"),
        "candidate_id": candidate_id or None,
        "position_id": position_id or None,
        "expected_salary_min": profile.get("expected_salary_min"),
        "expected_salary_max": profile.get("expected_salary_max"),
        "current_salary": profile.get("current_salary"),
        "budget_min": profile.get("budget_min"),
        "budget_max": profile.get("budget_max"),
        "offer_salary": offer_salary,
        "offer_status": normalize_offer_status(profile.get("offer_status")) or "draft",
        "notes": normalize_text(profile.get("notes")) or None,
        "created_at": normalize_text(profile.get("created_at")) or None,
        "updated_at": normalize_text(profile.get("updated_at")) or None,
        "candidate": candidate_card,
        "position": position_card,
        "market_benchmark": benchmark_output,
        "market_position": market_position,
        "offer_vs_market": offer_vs_market,
    }


def build_salary_decision_dashboard_payload(
    profiles: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    positions: list[dict[str, Any]],
    benchmarks: list[dict[str, Any]],
) -> dict[str, Any]:
    candidate_lookup = {
        normalize_text(item.get("id")): item
        for item in candidates
        if normalize_text(item.get("id"))
    }
    position_lookup = {
        normalize_text(item.get("id")): item
        for item in positions
        if normalize_text(item.get("id"))
    }
    benchmark_cards = [_build_salary_benchmark_card(item) for item in benchmarks]
    benchmark_lookup = {item["key"]: item for item in benchmark_cards}
    profile_cards = [
        _build_salary_profile_card(profile, candidate_lookup, position_lookup, benchmark_lookup)
        for profile in profiles
    ]

    offer_status_counts: dict[str, int] = {}
    market_position_counts: dict[str, int] = {}
    for profile in profile_cards:
        status = normalize_offer_status(profile.get("offer_status")) or "unknown"
        offer_status_counts[status] = offer_status_counts.get(status, 0) + 1
        market_position = normalize_text(profile.get("market_position")) or "unknown"
        market_position_counts[market_position] = market_position_counts.get(market_position, 0) + 1

    summary = {
        "profile_count": len(profile_cards),
        "candidate_count": len(candidate_lookup),
        "position_count": len(position_lookup),
        "benchmark_count": len(benchmark_cards),
        "offer_status_counts": offer_status_counts,
        "market_position_counts": market_position_counts,
        "latest_profile_updated_at": profile_cards[0]["updated_at"] if profile_cards else None,
    }
    return {
        "summary": summary,
        "benchmarks": benchmark_cards,
        "profiles": profile_cards,
        "meta": {
            "as_of": now_iso(),
        },
    }


def fetch_salary_decision_dashboard_data(client: Client) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        profiles = db.many(
            client.table("candidate_salary_profiles")
            .select("*")
            .order("updated_at", desc=True)
            .execute()
        )
        candidate_ids = [
            normalize_text(item.get("candidate_id"))
            for item in profiles
            if normalize_text(item.get("candidate_id"))
        ]
        position_ids = [
            normalize_text(item.get("position_id"))
            for item in profiles
            if normalize_text(item.get("position_id"))
        ]
        candidates = (
            db.many(
                client.table("candidates")
                .select("*")
                .in_("id", candidate_ids)
                .execute()
            )
            if candidate_ids
            else []
        )
        positions = (
            db.many(
                client.table("active_positions")
                .select("*")
                .in_("id", position_ids)
                .execute()
            )
            if position_ids
            else []
        )
        benchmarks = db.many(
            client.table("market_salary_benchmarks")
            .select("*")
            .order("updated_at", desc=True)
            .limit(100)
            .execute()
        )
        return profiles, candidates, positions, benchmarks
    except Exception as error:
        if is_missing_table_error(
            error,
            ("candidate_salary_profiles", "market_salary_benchmarks"),
        ):
            return [], [], [], []
        raise


app = FastAPI(title="RecruitPro FastAPI Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def healthcheck() -> dict[str, Any]:
    return {"ok": True}


@app.get("/api/dashboard")
def get_dashboard_data(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    positions = db.many(
        client.table("active_positions")
        .select("id,title,department,location,status")
        .order("created_at", desc=True)
        .execute()
    )
    candidates = db.many(
        client.table("candidates")
        .select("id,name,edu,exp")
        .order("created_at", desc=True)
        .limit(6)
        .execute()
    )
    interviews = db.many(
        client.table("upcoming_interviews")
        .select("id,name,stage,position")
        .order("created_at", desc=True)
        .limit(8)
        .execute()
    )
    return {
        "positions": positions,
        "candidates": candidates,
        "interviews": interviews,
    }


@app.get("/api/settings/company")
def get_company_settings(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    row = db.first(client.table("company_settings").select("*").limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Company settings not found")
    return row


@app.patch("/api/settings/company")
def update_company_settings(
    payload: CompanySettingsPatchPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    current = db.first(client.table("company_settings").select("id").limit(1).execute())
    if not current or not current.get("id"):
        raise HTTPException(status_code=404, detail="Company settings not found")
    patch = dict(payload.patch or {})
    patch["updated_by"] = user["id"]
    row = db.first(client.table("company_settings").update(patch).eq("id", current["id"]).execute())
    if not row:
        raise HTTPException(status_code=500, detail="Update company settings failed")
    return row


@app.get("/api/salaries")
def list_market_salaries(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    require_user(authorization)
    client = db.get_client()
    return db.many(
        client.table("market_salaries")
        .select("*")
        .order("average_salary", desc=True)
        .execute()
    )


@app.get("/api/salary/dashboard")
def get_salary_dashboard(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client(get_bearer_token(authorization))
    try:
        benchmarks = db.many(
            client.table("market_salary_benchmarks")
            .select("*")
            .order("updated_at", desc=True)
            .limit(50)
            .execute()
        )
        crawl_jobs = db.many(
            client.table("market_salary_crawl_jobs")
            .select("*")
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
    except Exception as error:
        if is_missing_table_error(
            error,
            ("market_salary_benchmarks", "market_salary_crawl_jobs"),
        ):
            return build_salary_dashboard_payload([], [])
        raise
    return build_salary_dashboard_payload(benchmarks, crawl_jobs)


@app.get("/api/salary/decision-dashboard")
def get_salary_decision_dashboard(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client(get_bearer_token(authorization))
    profiles, candidates, positions, benchmarks = fetch_salary_decision_dashboard_data(client)
    return build_salary_decision_dashboard_payload(profiles, candidates, positions, benchmarks)


@app.post("/api/salary/market/import")
def import_salary_market_records(
    payload: SalaryMarketImportPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    source = normalize_text(payload.source) or "unknown"
    records = [record.model_dump() for record in payload.records]
    ingestion_summary = ingest_market_salary_records(client, source, records)
    refresh_summary = refresh_market_salary_benchmarks(client)
    return {
        "ok": True,
        "summary": {
            **ingestion_summary,
            "benchmark_count": refresh_summary["benchmark_count"],
            "deleted_benchmark_count": refresh_summary["deleted_benchmark_count"],
        },
        "benchmarks": refresh_summary["benchmarks"],
    }


@app.post("/api/salary/market/refresh")
def refresh_salary_market_foundation(
    payload: SalaryMarketRefreshPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    refresh_summary = refresh_market_salary_benchmarks(client, min_samples=payload.min_samples)
    return {
        "ok": True,
        "summary": refresh_summary,
    }


@app.patch("/api/salary/candidate-profile/{profile_id}")
def patch_candidate_salary_profile(
    profile_id: str,
    payload: CandidateSalaryProfilePatchPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(
        client.table("candidate_salary_profiles")
        .select("*")
        .eq("id", profile_id)
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate salary profile not found")

    patch: dict[str, Any] = {}
    if payload.offer_salary is not None:
        patch["offer_salary"] = payload.offer_salary
    if payload.offer_status is not None:
        normalized_status = normalize_offer_status(payload.offer_status)
        if not normalized_status:
            raise HTTPException(status_code=400, detail="offer_status is required")
        patch["offer_status"] = normalized_status
    if payload.notes is not None:
        patch["notes"] = normalize_text(payload.notes) or None

    if not patch:
        raise HTTPException(status_code=400, detail="At least one field is required")

    updated = db.first(
        client.table("candidate_salary_profiles")
        .update(patch)
        .eq("id", profile_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Update candidate salary profile failed")

    candidate_id = normalize_text(updated.get("candidate_id"))
    position_id = normalize_text(updated.get("position_id"))
    candidate = (
        db.first(client.table("candidates").select("*").eq("id", candidate_id).limit(1).execute())
        if candidate_id
        else None
    )
    position = (
        db.first(client.table("active_positions").select("*").eq("id", position_id).limit(1).execute())
        if position_id
        else None
    )
    benchmarks = db.many(
        client.table("market_salary_benchmarks")
        .select("*")
        .order("updated_at", desc=True)
        .limit(100)
        .execute()
    )
    dashboard_payload = build_salary_decision_dashboard_payload(
        [updated],
        [candidate] if candidate else [],
        [position] if position else [],
        benchmarks,
    )
    return {
        "ok": True,
        "profile_id": profile_id,
        "updated_fields": list(patch.keys()),
        "profile": dashboard_payload["profiles"][0] if dashboard_payload["profiles"] else None,
    }


@app.post("/api/llm-usage")
def create_llm_usage_event(
    payload: LlmUsageEventPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("llm_usage_events")
        .insert(
            {
                "model_id": payload.model_id,
                "provider": payload.provider,
                "model_name": payload.model_name,
                "api_protocol": payload.api_protocol,
                "scene": payload.scene,
                "request_scope": payload.request_scope,
                "resume_upload_id": payload.resume_upload_id,
                "candidate_id": payload.candidate_id,
                "position_id": payload.position_id,
                "interview_session_id": payload.interview_session_id,
                "input_tokens": payload.input_tokens,
                "output_tokens": payload.output_tokens,
                "total_tokens": payload.total_tokens,
                "latency_ms": payload.latency_ms,
                "success": payload.success,
                "error_code": payload.error_code,
                "metadata": payload.metadata or {},
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create llm usage event failed")
    return {"ok": True, "id": row.get("id")}


@app.get("/api/admin/has-super-admin")
def get_has_super_admin(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    response = client.rpc("has_super_admin").execute()
    return {"has_super_admin": bool(getattr(response, "data", False))}


@app.post("/api/admin/claim-initial-super-admin")
def claim_initial_super_admin(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    response = client.rpc("claim_initial_super_admin").execute()
    return {"ok": True, "claimed": bool(getattr(response, "data", False))}


@app.get("/api/admin/users")
def list_admin_users(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_super_admin_user(authorization)
    client = db.get_client()
    rpc_error: str | None = None
    users: list[dict[str, Any]] = []

    try:
        response = client.rpc("admin_list_user_roles").execute()
        users = db.many(response)
    except Exception as exc:
        rpc_error = str(exc)

    if not users:
        fallback = db.many(
            client.table("user_roles")
            .select("id,email,role,permissions,created_at")
            .order("created_at")
            .execute()
        )
        if fallback:
            users = fallback

    if not users:
        metadata = user.get("user_metadata") if isinstance(user.get("user_metadata"), dict) else {}
        username = normalize_text(metadata.get("name")) or normalize_text(metadata.get("full_name")) or normalize_text(user.get("email")).split("@")[0] or "未命名用户"
        users = [
            {
                "id": user["id"],
                "username": username,
                "email": user.get("email") or "",
                "role": "user",
                "permissions": [],
            }
        ]

    normalized_users = []
    for row in users:
        email = normalize_text(row.get("email"))
        username = normalize_text(row.get("username")) or (email.split("@")[0] if email else "未命名用户")
        normalized_users.append(
            {
                "id": row.get("id"),
                "username": username,
                "email": email,
                "role": normalize_text(row.get("role")) or "user",
                "permissions": row.get("permissions") if isinstance(row.get("permissions"), list) else [],
                "created_at": row.get("created_at"),
            }
        )

    return {"users": normalized_users, "rpc_error": rpc_error}


@app.post("/api/admin/users/{target_user_id}/permissions")
def update_admin_user_permissions(
    target_user_id: str,
    payload: AdminPermissionsPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_super_admin_user(authorization)
    client = db.get_client()
    response = client.rpc(
        "admin_update_user_permissions",
        {
            "target_user_id": target_user_id,
            "new_permissions": payload.new_permissions,
        },
    ).execute()
    return {"ok": True, "data": getattr(response, "data", None)}


@app.post("/api/admin/users/{target_user_id}/role")
def update_admin_user_role(
    target_user_id: str,
    payload: AdminRolePayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_super_admin_user(authorization)
    client = db.get_client()
    response = client.rpc(
        "admin_update_user_role",
        {
            "target_user_id": target_user_id,
            "new_role": payload.new_role,
        },
    ).execute()
    return {"ok": True, "data": getattr(response, "data", None)}


@app.get("/api/interviews")
def list_interviews(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()

    interviews = db.many(client.table("upcoming_interviews").select("*").order("created_at", desc=True).execute())
    reports = db.many(
        client.table("interview_reports")
        .select("id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score,human_confirmed,human_confirmed_by,human_confirmed_at,generated_by,created_at,updated_at")
        .order("updated_at", desc=True)
        .execute()
    )

    report_map: dict[str, dict[str, Any]] = {}
    for report in reports:
        interview_id = normalize_text(report.get("interview_id"))
        if interview_id and interview_id not in report_map:
            report_map[interview_id] = report

    return {
        "items": [
            {
                **interview,
                "latest_report": report_map.get(str(interview.get("id"))),
            }
            for interview in interviews
        ]
    }


@app.post("/api/interviews")
def create_interview_schedule(payload: UpsertInterviewSchedulePayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("upcoming_interviews")
        .insert(
            {
                "candidate_id": payload.candidate_id,
                "name": payload.name,
                "stage": payload.stage,
                "position": payload.position,
                "schedule_time": payload.schedule_time,
                "interviewer": payload.interviewer,
                "location_type": payload.location_type,
                "status": payload.status or "scheduled",
                "join_url": payload.join_url,
                "updated_by": user["id"],
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create interview failed")
    return row


@app.post("/api/interview-sessions")
def create_interview_session(
    payload: CreateInterviewSessionPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("interview_sessions")
        .insert(
            {
                "interview_id": payload.interview_id,
                "candidate_id": payload.candidate_id,
                "position_id": payload.position_id,
                "mode": payload.mode or "async_qa",
                "status": payload.status or "preparing",
                "question_plan": payload.question_plan or [],
                "context_payload": payload.context_payload or {},
                "created_by": user["id"],
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create interview session failed")
    return row


@app.patch("/api/interview-sessions/{session_id}/status")
def update_interview_session_status(
    session_id: str,
    payload: UpdateInterviewSessionStatusPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("interview_sessions")
        .update(
            {
                "status": payload.status,
                "started_at": payload.started_at,
                "ended_at": payload.ended_at,
            }
        )
        .eq("id", session_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Update interview session status failed")
    return row


@app.post("/api/interview-turns")
def create_interview_turn(
    payload: CreateInterviewTurnPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("interview_turns")
        .insert(
            {
                "session_id": payload.session_id,
                "turn_no": payload.turn_no or next_turn_no(payload.session_id),
                "speaker": payload.speaker,
                "content": payload.content,
                "input_mode": payload.input_mode or "text",
                "latency_ms": payload.latency_ms,
                "tokens_in": payload.tokens_in,
                "tokens_out": payload.tokens_out,
                "confidence": payload.confidence,
                "metadata": payload.metadata or {},
                "created_by": user["id"],
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create interview turn failed")
    return row


@app.post("/api/interview-reports")
def upsert_interview_report(
    payload: UpsertInterviewReportPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("interview_reports")
        .upsert(
            {
                "session_id": payload.session_id,
                "interview_id": payload.interview_id,
                "candidate_id": payload.candidate_id,
                "overall_score": payload.overall_score,
                "dimension_scores": payload.dimension_scores or {},
                "strengths": payload.strengths or [],
                "risks": payload.risks or [],
                "recommendation": payload.recommendation,
                "evidence": payload.evidence or [],
                "summary": payload.summary,
                "risk_score": payload.risk_score,
                "human_confirmed": payload.human_confirmed,
                "human_confirmed_by": payload.human_confirmed_by,
                "human_confirmed_at": payload.human_confirmed_at,
                "generated_by": payload.generated_by or user["id"],
            },
            on_conflict="session_id",
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Upsert interview report failed")
    return row


@app.get("/api/interviews/{interview_id}")
def get_interview(interview_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    interview = db.first(client.table("upcoming_interviews").select("*").eq("id", interview_id).limit(1).execute())
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview


@app.patch("/api/interviews/{interview_id}")
def update_interview_schedule(
    interview_id: str,
    payload: UpsertInterviewSchedulePayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("upcoming_interviews").select("id").eq("id", interview_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Interview not found")

    row = db.first(
        client.table("upcoming_interviews")
        .update(
            {
                "candidate_id": payload.candidate_id,
                "name": payload.name,
                "stage": payload.stage,
                "position": payload.position,
                "schedule_time": payload.schedule_time,
                "interviewer": payload.interviewer,
                "location_type": payload.location_type,
                "status": payload.status,
                "join_url": payload.join_url,
                "updated_by": user["id"],
            }
        )
        .eq("id", interview_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Update interview failed")
    return row


@app.delete("/api/interviews/{interview_id}")
def delete_interview_schedule(interview_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("upcoming_interviews").select("id").eq("id", interview_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Interview not found")
    client.table("upcoming_interviews").delete().eq("id", interview_id).execute()
    return {"ok": True, "id": interview_id}


@app.get("/api/screening/dashboard")
def get_screening_dashboard(position_id: str | None = None, uploads_limit: int = 8, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()

    positions = db.many(
        client.table("active_positions")
        .select("id,title,technical_requirements,min_exp,min_edu,max_age,threshold_score,department,location,screening_recalc_needed,screening_recalc_reason,screening_recalc_fields,screening_recalc_requested_at,screening_last_reviewed_at")
        .order("created_at", desc=True)
        .execute()
    )
    uploads = db.many(
        client.table("resume_uploads")
        .select("id,file_name,file_path,position_id,mime_type,status,pipeline_stage,error_code,error_message,retry_count,stage_started_at,created_at")
        .order("created_at", desc=True)
        .limit(max(1, min(uploads_limit, 50)))
        .execute()
    )

    resolved_position_id = normalize_text(position_id)
    if not resolved_position_id and positions:
        resolved_position_id = normalize_text(positions[0].get("id"))

    candidates = build_screening_candidates(client, resolved_position_id) if resolved_position_id else []
    return {
        "positions": positions,
        "uploads": uploads,
        "candidates": candidates,
        "selected_position_id": resolved_position_id or None,
    }


@app.get("/api/screening/runtime-config")
def get_screening_runtime_config(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    company_settings, llm_models = get_screening_runtime_data(client)
    return {
        "company_settings": company_settings or {},
        "llm_models": llm_models,
    }


@app.post("/api/screening/job-requirement/resolve")
def resolve_job_requirement(payload: ResolveJobRequirementPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    position = payload.position
    position_id = normalize_text(position.get("id"))
    if not position_id:
        raise HTTPException(status_code=400, detail="position.id is required")

    existing = db.many(
        client.table("parsed_job_requirements")
        .select("id,must_have_skills,nice_to_have_skills,required_experience_years,education_requirement,industry_preference,project_keywords,seniority_level,core_responsibilities,position_title")
        .eq("position_id", position_id)
        .eq("is_active", True)
        .order("version_no", desc=True)
        .limit(1)
        .execute()
    )
    if existing:
        item = existing[0]
        return {
            "id": str(item["id"]),
            "payload": {
                "position_title": item.get("position_title") or position.get("title"),
                "must_have_skills": item.get("must_have_skills") or [],
                "nice_to_have_skills": item.get("nice_to_have_skills") or [],
                "required_experience_years": item.get("required_experience_years"),
                "education_requirement": item.get("education_requirement") or {"min_level": position.get("min_edu"), "is_strict": True},
                "industry_preference": item.get("industry_preference") or [],
                "project_keywords": item.get("project_keywords") or [],
                "seniority_level": item.get("seniority_level") or "mid",
                "core_responsibilities": item.get("core_responsibilities") or [],
            },
        }

    generated_payload = build_job_requirement_from_position(position)
    inserted = db.first(
        client.table("parsed_job_requirements")
        .insert(
            [
                {
                    "position_id": position_id,
                    "version_no": 1,
                    "is_active": True,
                    "position_title": generated_payload["position_title"],
                    "must_have_skills": generated_payload["must_have_skills"],
                    "nice_to_have_skills": generated_payload["nice_to_have_skills"],
                    "required_experience_years": generated_payload["required_experience_years"],
                    "education_requirement": generated_payload["education_requirement"],
                    "industry_preference": generated_payload["industry_preference"],
                    "project_keywords": generated_payload["project_keywords"],
                    "seniority_level": generated_payload["seniority_level"],
                    "core_responsibilities": generated_payload["core_responsibilities"],
                    "source_text": position.get("technical_requirements"),
                    "prompt_version": "phase1-job-v1",
                    "model_version": "rule-based-bootstrap",
                    "pipeline_version": "phase1",
                }
            ]
        )
        .execute()
    )
    if not inserted or not inserted.get("id"):
        raise HTTPException(status_code=500, detail="创建岗位结构化要求失败")
    return {"id": str(inserted["id"]), "payload": generated_payload}


POSITION_SELECT_FIELDS = (
    "id,title,department,location,status,threshold_score,technical_requirements,max_age,min_edu,min_exp,"
    "screening_recalc_needed,screening_recalc_reason,screening_recalc_fields,screening_recalc_requested_at,"
    "screening_last_reviewed_at,created_at"
)


def build_position_write_payload(payload: PositionPayload, user_id: str) -> dict[str, Any]:
    return {
        "title": normalize_text(payload.title),
        "department": payload.department,
        "location": payload.location,
        "status": payload.status,
        "threshold_score": payload.threshold_score,
        "technical_requirements": payload.technical_requirements,
        "max_age": payload.max_age,
        "min_edu": payload.min_edu,
        "min_exp": payload.min_exp,
        "screening_recalc_needed": payload.screening_recalc_needed,
        "screening_recalc_reason": payload.screening_recalc_reason,
        "screening_recalc_fields": payload.screening_recalc_fields or [],
        "screening_recalc_requested_at": payload.screening_recalc_requested_at,
        "screening_last_reviewed_at": payload.screening_last_reviewed_at,
        "updated_by": user_id,
    }


@app.get("/api/positions")
def list_positions(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    require_user(authorization)
    client = db.get_client()
    return db.many(
        client.table("active_positions")
        .select(POSITION_SELECT_FIELDS)
        .order("created_at", desc=True)
        .execute()
    )


@app.post("/api/positions")
def create_position(payload: PositionPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("active_positions")
        .insert(build_position_write_payload(payload, user["id"]))
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create position failed")
    return row


@app.patch("/api/positions/{position_id}")
def update_position(
    position_id: str,
    payload: PositionPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("active_positions").select("id").eq("id", position_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Position not found")
    row = db.first(
        client.table("active_positions")
        .update(build_position_write_payload(payload, user["id"]))
        .eq("id", position_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Update position failed")
    return row


@app.delete("/api/positions/{position_id}")
def delete_position(position_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("active_positions").select("id").eq("id", position_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Position not found")
    client.table("active_positions").delete().eq("id", position_id).execute()
    return {"ok": True, "id": position_id}


@app.patch("/api/positions/{position_id}/screening-review")
def acknowledge_position_screening_review(
    position_id: str,
    payload: ScreeningReviewAcknowledgePayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("active_positions").select("id").eq("id", position_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Position not found")

    row = db.first(
        client.table("active_positions")
        .update(
            {
                "screening_recalc_needed": payload.screening_recalc_needed,
                "screening_recalc_reason": payload.screening_recalc_reason,
                "screening_recalc_fields": payload.screening_recalc_fields or [],
                "screening_last_reviewed_at": payload.screening_last_reviewed_at or now_iso(),
                "updated_by": user["id"],
            }
        )
        .eq("id", position_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Update position screening review failed")
    return row


@app.patch("/api/matches/{match_id}/manual-review")
def update_match_manual_review(
    match_id: str,
    payload: MatchManualReviewPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("candidate_position_matches").select("*").eq("id", match_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Match not found")

    row = db.first(
        client.table("candidate_position_matches")
        .update(
            {
                "human_decision": payload.human_decision,
                "review_note": payload.review_note,
                "reviewed_at": payload.reviewed_at,
            }
        )
        .eq("id", match_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Update manual review failed")
    return row


@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("candidates").select("id").eq("id", candidate_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate not found")
    client.table("candidates").delete().eq("id", candidate_id).execute()
    return {"ok": True, "id": candidate_id}


@app.post("/api/candidates/delete-batch")
def delete_candidates_batch(
    payload: DeleteCandidatesPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    candidate_ids = [normalize_text(item) for item in payload.candidate_ids if normalize_text(item)]
    if not candidate_ids:
        raise HTTPException(status_code=400, detail="candidate_ids is required")
    client = db.get_client()
    client.table("candidates").delete().in_("id", candidate_ids).execute()
    return {"ok": True, "deleted_ids": candidate_ids}


@app.get("/api/candidates")
def list_candidates(
    page: int = 1,
    page_size: int = 20,
    query: str | None = None,
    edu_level: str | None = None,
    min_match: int | None = None,
    min_exp_years: int | None = None,
    max_age: int | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    safe_page = max(1, page)
    safe_page_size = max(1, min(100, page_size))
    from_index = (safe_page - 1) * safe_page_size
    to_index = from_index + safe_page_size - 1

    request = (
        client.table("candidates")
        .select("id,name,title,exp,exp_years,edu_level,edu,age,match,created_at", count="exact")
        .order("created_at", desc=True)
    )
    normalized_query = normalize_text(query)
    if normalized_query:
        escaped_query = normalized_query.replace(",", " ").replace("%", "")
        request = request.or_(f"name.ilike.%{escaped_query}%,title.ilike.%{escaped_query}%,exp.ilike.%{escaped_query}%")
    normalized_edu = normalize_text(edu_level)
    if normalized_edu:
        request = request.or_(f"edu_level.eq.{normalized_edu},edu.eq.{normalized_edu}")
    if isinstance(min_match, int):
        request = request.gte("match", min_match)
    if isinstance(min_exp_years, int):
        request = request.gte("exp_years", min_exp_years)
    if isinstance(max_age, int):
        request = request.lte("age", max_age)

    response = request.range(from_index, to_index).execute()
    return {
        "items": db.many(response),
        "total": int(getattr(response, "count", 0) or 0),
        "page": safe_page,
        "page_size": safe_page_size,
    }


@app.get("/api/candidates/{candidate_id}/detail")
def get_candidate_detail(
    candidate_id: str,
    match_id: str | None = None,
    position_id: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()

    candidate = db.first(client.table("candidates").select("*").eq("id", candidate_id).limit(1).execute())
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    route_match_id = normalize_text(match_id)
    route_position_id = normalize_text(position_id)
    latest_match: dict[str, Any] | None = None

    if route_match_id:
        route_matches = db.many(
            client.table("candidate_position_matches")
            .select("*")
            .eq("candidate_id", candidate_id)
            .eq("id", route_match_id)
            .execute()
        )
        latest_match = route_matches[0] if route_matches else None

        if latest_match and is_rule_only_historical_match(latest_match):
            richer_matches = db.many(
                client.table("candidate_position_matches")
                .select("*")
                .eq("candidate_id", candidate_id)
                .order("created_at", desc=True)
                .execute()
            )
            scoped_matches = [item for item in richer_matches if normalize_text(item.get("position_id")) == route_position_id] if route_position_id else richer_matches
            latest_match = pick_preferred_match(scoped_matches) or pick_preferred_match(richer_matches) or latest_match

    if latest_match is None and route_position_id:
        position_matches = db.many(
            client.table("candidate_position_matches")
            .select("*")
            .eq("candidate_id", candidate_id)
            .eq("position_id", route_position_id)
            .order("created_at", desc=True)
            .execute()
        )
        latest_match = pick_preferred_match(position_matches)

    if latest_match is None:
        fallback_matches = db.many(
            client.table("candidate_position_matches")
            .select("*")
            .eq("candidate_id", candidate_id)
            .order("created_at", desc=True)
            .execute()
        )
        latest_match = pick_preferred_match(fallback_matches)

    projects: list[dict[str, Any]] = []
    risk_flags: list[dict[str, Any]] = []
    evidence_spans: list[dict[str, Any]] = []

    profile_id = normalize_text(latest_match.get("profile_id") if latest_match else None)
    if profile_id:
        projects = db.many(
            client.table("parsed_resume_projects")
            .select("id,project_name,project_summary,tech_stack,leadership_level,complexity_level")
            .eq("profile_id", profile_id)
            .order("project_index")
            .execute()
        )
        profile = db.first(
            client.table("parsed_resume_profiles")
            .select("risk_flags,parser_raw_json")
            .eq("id", profile_id)
            .limit(1)
            .execute()
        )
        profile_risk_flags = profile.get("risk_flags") if isinstance(profile, dict) else None
        parser_raw_json = profile.get("parser_raw_json") if isinstance(profile, dict) else None
        risk_flags = profile_risk_flags if isinstance(profile_risk_flags, list) else []
        evidence_spans = parser_raw_json.get("evidence_spans") if isinstance(parser_raw_json, dict) and isinstance(parser_raw_json.get("evidence_spans"), list) else []

    return {
        "candidate": candidate,
        "match": latest_match,
        "projects": projects,
        "risk_flags": risk_flags,
        "evidence_spans": evidence_spans,
    }


@app.post("/api/uploads/delete")
def delete_failed_uploads(payload: DeleteUploadsPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    upload_ids = [item for item in payload.upload_ids if normalize_text(item)]
    if not upload_ids:
        raise HTTPException(status_code=400, detail="upload_ids is required")

    storage_paths = [item for item in (payload.storage_paths or []) if normalize_text(item)]
    if storage_paths:
        try:
            client.storage.from_("resume-files").remove(storage_paths)
        except Exception:
            pass

    client.table("resume_uploads").delete().in_("id", upload_ids).execute()
    return {"ok": True, "deleted_count": len(upload_ids)}


@app.patch("/api/uploads/{upload_id}")
def update_upload_state(upload_id: str, payload: UploadStatePatchPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("resume_uploads").select("id").eq("id", upload_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Upload not found")
    row = db.first(client.table("resume_uploads").update(payload.patch).eq("id", upload_id).execute())
    if not row:
        raise HTTPException(status_code=500, detail="Update upload state failed")
    return row


@app.post("/api/uploads")
def create_upload(payload: CreateUploadPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    row = db.first(
        client.table("resume_uploads")
        .insert(
            [
                {
                    "position_id": payload.position_id,
                    "file_name": payload.file_name,
                    "file_path": payload.file_path,
                    "file_size_bytes": payload.file_size_bytes,
                    "mime_type": payload.mime_type,
                    "status": "processing",
                    "pipeline_stage": "uploaded",
                    "stage_started_at": now_iso(),
                    "file_hash": payload.file_hash,
                }
            ]
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Create upload failed")
    return row


@app.post("/api/uploads/content")
async def upload_resume_content(
    position_id: str = Form(...),
    upload_path: str = Form(...),
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()

    if not normalize_text(position_id):
        raise HTTPException(status_code=400, detail="position_id is required")
    if not normalize_text(upload_path):
        raise HTTPException(status_code=400, detail="upload_path is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="file is empty")

    try:
        client.storage.from_("resume-files").upload(
            upload_path,
            content,
            {
                "cache-control": "3600",
                "upsert": "false",
                "content-type": file.content_type or "application/octet-stream",
            },
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Upload resume content failed: {error}") from error

    return {
        "ok": True,
        "position_id": position_id,
        "upload_path": upload_path,
        "file_name": file.filename,
    }


@app.post("/api/screening/phase1")
async def run_phase1_screening(
    position_json: str = Form(...),
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_user(authorization)
    try:
        position = json.loads(position_json)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid position_json: {error}") from error

    if not isinstance(position, dict) or not normalize_text(position.get("id")):
        raise HTTPException(status_code=400, detail="position_json is invalid")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="file is empty")

    file_hash = hashlib.sha256(content).hexdigest()
    safe_file_name = re.sub(r"[^A-Za-z0-9._-]+", "-", file.filename or "resume")
    upload_path = f"{position['id']}/{secrets.token_hex(8)}-{safe_file_name}"

    upload_row = create_upload(
        CreateUploadPayload(
            position_id=str(position["id"]),
            file_name=file.filename or "resume",
            file_path=upload_path,
            file_size_bytes=len(content),
            mime_type=file.content_type,
            file_hash=file_hash,
        ),
        authorization,
    )
    resume_upload_id = str(upload_row["id"])

    try:
        client = db.get_client()
        company_settings, _ = get_screening_runtime_data(client)
        client.storage.from_("resume-files").upload(
            upload_path,
            content,
            {
                "cache-control": "3600",
                "upsert": "false",
                "content-type": file.content_type or "application/octet-stream",
            },
        )

        update_upload_state(
            resume_upload_id,
            UploadStatePatchPayload(
                patch={
                    "pipeline_stage": "text_extraction",
                    "status": "processing",
                    "stage_started_at": now_iso(),
                    "error_code": None,
                    "error_message": None,
                }
            ),
            authorization,
        )

        text, quality, source = extract_text_from_upload(file.filename or "resume", content)
        if quality != "good":
            ocr_config = {
                "enabled": bool(company_settings.get("ocr_enabled")),
                "base_url": company_settings.get("ocr_base_url"),
                "api_key": company_settings.get("ocr_api_key"),
                "timeout_ms": company_settings.get("ocr_timeout_ms"),
            }
            try:
                ocr_text = await call_ocr_service(content, file.filename or "resume", ocr_config)
                normalized_ocr = re.sub(r"\s+", " ", normalize_text(ocr_text)).strip()
                if len(normalized_ocr) >= 120:
                    text = normalized_ocr[:20000]
                    quality = "good" if len(normalized_ocr) >= 300 else "poor"
                    source = "ocr"
                elif not text:
                    text = f"文件名: {file.filename}; OCR 结果不足，建议人工复核。"
                    quality = "poor"
                    source = "fallback"
            except Exception:
                if not text:
                    text = f"文件名: {file.filename}; OCR 调用失败，建议人工复核。"
                    quality = "poor"
                    source = "fallback"

        update_upload_state(
            resume_upload_id,
            UploadStatePatchPayload(
                patch={
                    "pipeline_stage": "profile_extraction",
                    "status": "processing",
                    "stage_started_at": now_iso(),
                }
            ),
            authorization,
        )

        job_requirement = build_job_requirement_from_position(position)
        match_weights = load_match_weights(client)
        profile_payload = build_resume_profile_from_text(file.filename or "resume", text, quality)

        update_upload_state(
            resume_upload_id,
            UploadStatePatchPayload(
                patch={
                    "pipeline_stage": "matching",
                    "status": "processing",
                    "stage_started_at": now_iso(),
                }
            ),
            authorization,
        )

        match_output = build_match_output(profile_payload, job_requirement, match_weights)
        basic_profile = profile_payload["basic_profile"]
        first_education = profile_payload["education"][0] if profile_payload["education"] else {}
        years = basic_profile.get("years_of_experience")
        candidate_patch = {
            "p_id": position["id"],
            "name": basic_profile.get("full_name") or re.sub(r"\.(pdf|doc|docx)$", "", file.filename or "resume", flags=re.IGNORECASE) or "未命名候选人",
            "title": basic_profile.get("current_title") or position.get("title") or "未知职位",
            "exp": f"{years}年经验" if isinstance(years, (int, float)) else "经验未明确",
            "exp_years": round(years) if isinstance(years, (int, float)) else None,
            "edu": first_education.get("degree") if isinstance(first_education, dict) else "学历未明确",
            "edu_level": first_education.get("degree") if isinstance(first_education, dict) else "学历未明确",
            "age": None,
            "match": int(match_output["overall_score"]),
            "prev_company": None,
            "tag": recommendation_to_tag(match_output["recommendation"]),
            "highlight": match_output["summary_reason"],
        }
        profile_llm_raw_json = {
            "mode": "phase1-rule-based-bootstrap",
            "generated_at": now_iso(),
            "routing": {"enabled": False},
        }
        match_llm_raw_json = {
            "mode": "phase1-rule-based-bootstrap",
            "generated_at": now_iso(),
            "routing": {"enabled": False},
        }
        persist = persist_phase1_result(
            PersistPhase1Payload(
                position=position,
                resume_upload_id=resume_upload_id,
                file_hash=file_hash,
                job_requirement=job_requirement,
                candidate_patch=candidate_patch,
                profile_payload={
                    **profile_payload,
                    "parser_raw_json": {
                        "text_preview": text[:1000],
                        "text_quality": quality,
                        "text_source": source,
                        "evidence_spans": profile_payload["evidence_spans"],
                    },
                },
                profile_llm_raw_json=profile_llm_raw_json,
                profile_model_version="rule-based-bootstrap",
                match_output=match_output,
                match_llm_raw_json=match_llm_raw_json,
                match_model_version="rule-based-bootstrap",
                parsed_payload={
                    "overall_score": match_output["overall_score"],
                    "recommendation": match_output["recommendation"],
                    "summary_reason": match_output["summary_reason"],
                    "extraction_confidence": profile_payload["extraction_confidence"],
                    "llm_routing": {"enabled": False},
                },
            ),
            authorization,
        )
        return {
            "candidateId": persist["candidateId"],
            "resumeUploadId": resume_upload_id,
            "profileId": persist["profileId"],
            "matchId": persist["matchId"],
            "overallScore": match_output["overall_score"],
            "recommendation": match_output["recommendation"],
        }
    except Exception as error:
        message = str(error) if str(error) else "未知错误"
        fail_single_upload(
            resume_upload_id,
            UploadTerminalPayload(message=message, error_code="PHASE1_PIPELINE_ERROR"),
            authorization,
        )
        raise HTTPException(status_code=500, detail=message) from error


@app.post("/api/uploads/mark-failed")
def mark_uploads_failed(payload: MarkUploadsFailedPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    upload_ids = [item for item in payload.upload_ids if normalize_text(item)]
    if not upload_ids:
        raise HTTPException(status_code=400, detail="upload_ids is required")

    row = db.first(
        client.table("resume_uploads")
        .update(
            {
                "status": "failed",
                "pipeline_stage": "failed",
                "error_code": normalize_text(payload.error_code) or "PROCESSING_STALLED",
                "error_message": normalize_text(payload.error_message) or "处理长时间未推进，系统已自动标记为失败",
            }
        )
        .in_("id", upload_ids)
        .eq("status", "processing")
        .execute()
    )
    return {"ok": True, "updated": bool(row), "count": len(upload_ids)}


@app.post("/api/uploads/{upload_id}/fail")
def fail_single_upload(upload_id: str, payload: UploadTerminalPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    current = db.first(client.table("resume_uploads").select("retry_count").eq("id", upload_id).limit(1).execute())
    if not current:
        raise HTTPException(status_code=404, detail="Upload not found")
    current_retry = int(to_number(current.get("retry_count"), 0))
    row = db.first(
        client.table("resume_uploads")
        .update(
            {
                "status": "failed",
                "pipeline_stage": "failed",
                "error_code": normalize_text(payload.error_code) or "PHASE1_PIPELINE_ERROR",
                "error_message": normalize_text(payload.message) or "处理失败",
                "stage_finished_at": now_iso(),
                "retry_count": max(1, current_retry + 1),
            }
        )
        .eq("id", upload_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Mark upload failed failed")
    return row


@app.post("/api/uploads/{upload_id}/cancel")
def cancel_single_upload(upload_id: str, payload: UploadTerminalPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    existing = db.first(client.table("resume_uploads").select("id").eq("id", upload_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Upload not found")
    row = db.first(
        client.table("resume_uploads")
        .update(
            {
                "status": "failed",
                "pipeline_stage": "failed",
                "error_code": "USER_CANCELLED",
                "error_message": normalize_text(payload.message) or "已取消识别",
                "stage_finished_at": now_iso(),
            }
        )
        .eq("id", upload_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Cancel upload failed")
    return row


@app.post("/api/screening/persist-phase1")
def persist_phase1_result(payload: PersistPhase1Payload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()

    upload = db.first(client.table("resume_uploads").select("id").eq("id", payload.resume_upload_id).limit(1).execute())
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")

    position = payload.position
    position_id = normalize_text(position.get("id"))
    if not position_id:
        raise HTTPException(status_code=400, detail="position.id is required")

    existing_upload_rows = db.many(
        client.table("resume_uploads")
        .select("candidate_id")
        .eq("file_hash", payload.file_hash)
        .neq("id", payload.resume_upload_id)
        .not_.is_("candidate_id", "null")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    existing_candidate_id = str(existing_upload_rows[0].get("candidate_id")) if existing_upload_rows and existing_upload_rows[0].get("candidate_id") else ""

    candidate_id = existing_candidate_id
    if existing_candidate_id:
        updated_candidate = db.first(
            client.table("candidates")
            .update(payload.candidate_patch)
            .eq("id", existing_candidate_id)
            .execute()
        )
        if not updated_candidate:
            raise HTTPException(status_code=500, detail="Reuse candidate failed")
    else:
        created_candidate = db.first(client.table("candidates").insert([payload.candidate_patch]).execute())
        if not created_candidate or not created_candidate.get("id"):
            raise HTTPException(status_code=500, detail="Create candidate failed")
        candidate_id = str(created_candidate["id"])

    active_job_requirement = db.many(
        client.table("parsed_job_requirements")
        .select("id,must_have_skills,nice_to_have_skills,required_experience_years,education_requirement,industry_preference,project_keywords,seniority_level,core_responsibilities,position_title")
        .eq("position_id", position_id)
        .eq("is_active", True)
        .order("version_no", desc=True)
        .limit(1)
        .execute()
    )
    if active_job_requirement:
        job_requirement_id = str(active_job_requirement[0]["id"])
    else:
        inserted = db.first(
            client.table("parsed_job_requirements")
            .insert(
                [
                    {
                        "position_id": position_id,
                        "version_no": 1,
                        "is_active": True,
                        "position_title": payload.job_requirement.get("position_title"),
                        "must_have_skills": payload.job_requirement.get("must_have_skills"),
                        "nice_to_have_skills": payload.job_requirement.get("nice_to_have_skills"),
                        "required_experience_years": payload.job_requirement.get("required_experience_years"),
                        "education_requirement": payload.job_requirement.get("education_requirement"),
                        "industry_preference": payload.job_requirement.get("industry_preference"),
                        "project_keywords": payload.job_requirement.get("project_keywords"),
                        "seniority_level": payload.job_requirement.get("seniority_level"),
                        "core_responsibilities": payload.job_requirement.get("core_responsibilities"),
                        "source_text": position.get("technical_requirements"),
                        "prompt_version": "phase1-job-v1",
                        "model_version": "rule-based-bootstrap",
                        "pipeline_version": "phase1",
                    }
                ]
            )
            .execute()
        )
        if not inserted or not inserted.get("id"):
            raise HTTPException(status_code=500, detail="Persist job requirement failed")
        job_requirement_id = str(inserted["id"])

    profile_insert = db.first(
        client.table("parsed_resume_profiles")
        .insert(
            [
                {
                    "resume_upload_id": payload.resume_upload_id,
                    "candidate_id": candidate_id,
                    "basic_profile": payload.profile_payload.get("basic_profile"),
                    "explicit_skills": payload.profile_payload.get("explicit_skills"),
                    "inferred_skills": payload.profile_payload.get("inferred_skills"),
                    "work_experience": payload.profile_payload.get("work_experience"),
                    "education": payload.profile_payload.get("education"),
                    "certifications": payload.profile_payload.get("certifications"),
                    "risk_flags": payload.profile_payload.get("risk_flags"),
                    "extraction_confidence": payload.profile_payload.get("extraction_confidence"),
                    "parser_raw_json": payload.profile_payload.get("parser_raw_json"),
                    "llm_raw_json": payload.profile_llm_raw_json,
                    "prompt_version": "phase1-resume-v1",
                    "model_version": payload.profile_model_version,
                    "pipeline_version": "phase1",
                }
            ]
        )
        .execute()
    )
    if not profile_insert or not profile_insert.get("id"):
        raise HTTPException(status_code=500, detail="Persist profile failed")
    profile_id = str(profile_insert["id"])

    projects = payload.profile_payload.get("projects")
    if isinstance(projects, list) and projects:
        project_rows = []
        for index, project in enumerate(projects):
            if not isinstance(project, dict):
                continue
            project_rows.append(
                {
                    "profile_id": profile_id,
                    "project_index": index,
                    "project_name": project.get("project_name"),
                    "project_summary": project.get("project_summary"),
                    "candidate_role": project.get("candidate_role"),
                    "responsibilities": project.get("responsibilities"),
                    "tech_stack": project.get("tech_stack"),
                    "domain": project.get("domain"),
                    "complexity_level": project.get("complexity_level"),
                    "leadership_level": project.get("leadership_level"),
                    "evidence_spans": project.get("evidence_spans"),
                    "confidence": project.get("confidence"),
                }
            )
        if project_rows:
            client.table("parsed_resume_projects").insert(project_rows).execute()

    match_insert = db.first(
        client.table("candidate_position_matches")
        .insert(
            [
                {
                    "candidate_id": candidate_id,
                    "position_id": position_id,
                    "profile_id": profile_id,
                    "job_requirement_id": job_requirement_id,
                    "resume_upload_id": payload.resume_upload_id,
                    **payload.match_output,
                    "llm_raw_json": payload.match_llm_raw_json,
                    "prompt_version": "phase1-match-v1",
                    "model_version": payload.match_model_version,
                    "pipeline_version": "phase1",
                }
            ]
        )
        .execute()
    )
    if not match_insert or not match_insert.get("id"):
        raise HTTPException(status_code=500, detail="Persist match failed")
    match_id = str(match_insert["id"])

    final_parsed_payload = dict(payload.parsed_payload)
    final_parsed_payload["profile_id"] = profile_id
    final_parsed_payload["match_id"] = match_id

    client.table("resume_uploads").update(
        {
            "candidate_id": candidate_id,
            "parsed_payload": final_parsed_payload,
            "status": "completed",
            "pipeline_stage": "completed",
            "stage_finished_at": now_iso(),
            "error_code": None,
            "error_message": None,
        }
    ).eq("id", payload.resume_upload_id).execute()

    return {
        "candidateId": candidate_id,
        "profileId": profile_id,
        "matchId": match_id,
    }


@app.post("/api/screening/rescreen")
def rescreen_historical_candidates(payload: HistoricalRescreenPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    if payload.mode != "rule_only":
        raise HTTPException(status_code=400, detail="当前 FastAPI 版仅支持规则重筛，请先使用 rule_only")

    client = db.get_client()
    position = db.first(
        client.table("active_positions")
        .select("id,title,technical_requirements,min_exp,min_edu,max_age,threshold_score,department,location")
        .eq("id", payload.position_id)
        .limit(1)
        .execute()
    )
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    candidate_ids = dedupe_keep_order(payload.candidate_ids)
    if not candidate_ids:
        return {"processed": 0, "rescored": 0, "skipped": 0, "failed": 0, "details": []}

    match_weights = load_match_weights(client)
    job_requirement_id, job_requirement_payload = create_job_requirement_snapshot(client, position)

    profile_rows = db.many(
        client.table("parsed_resume_profiles")
        .select("id,candidate_id,resume_upload_id,basic_profile,explicit_skills,inferred_skills,work_experience,education,certifications,risk_flags,extraction_confidence,parser_raw_json")
        .in_("candidate_id", candidate_ids)
        .order("created_at", desc=True)
        .execute()
    )
    latest_profile_by_candidate: dict[str, dict[str, Any]] = {}
    for row in profile_rows:
        candidate_id = normalize_text(row.get("candidate_id"))
        if candidate_id and candidate_id not in latest_profile_by_candidate:
            latest_profile_by_candidate[candidate_id] = row

    profile_ids = [normalize_text(item.get("id")) for item in latest_profile_by_candidate.values() if normalize_text(item.get("id"))]
    project_rows = (
        db.many(
            client.table("parsed_resume_projects")
            .select("profile_id,project_index,project_name,project_summary,candidate_role,responsibilities,tech_stack,domain,complexity_level,leadership_level,evidence_spans,confidence")
            .in_("profile_id", profile_ids)
            .order("project_index")
            .execute()
        )
        if profile_ids
        else []
    )
    projects_by_profile: dict[str, list[dict[str, Any]]] = {}
    for row in project_rows:
        profile_id = normalize_text(row.get("profile_id"))
        if not profile_id:
            continue
        projects_by_profile.setdefault(profile_id, []).append(row)

    details: list[dict[str, Any]] = []
    for candidate_id in candidate_ids:
        profile_row = latest_profile_by_candidate.get(candidate_id)
        if not profile_row:
            details.append({"candidateId": candidate_id, "status": "skipped", "reason": "缺少历史解析结果"})
            continue

        try:
            previous_matches = db.many(
                client.table("candidate_position_matches")
                .select("human_decision,review_note,reviewed_at,reviewed_by")
                .eq("candidate_id", candidate_id)
                .eq("position_id", position["id"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            previous_match = previous_matches[0] if previous_matches else {}
            profile_id = normalize_text(profile_row.get("id"))
            parser_raw = profile_row.get("parser_raw_json") if isinstance(profile_row.get("parser_raw_json"), dict) else {}
            profile_payload = {
                "basic_profile": profile_row.get("basic_profile") if isinstance(profile_row.get("basic_profile"), dict) else {},
                "explicit_skills": profile_row.get("explicit_skills") if isinstance(profile_row.get("explicit_skills"), list) else [],
                "inferred_skills": profile_row.get("inferred_skills") if isinstance(profile_row.get("inferred_skills"), list) else [],
                "projects": projects_by_profile.get(profile_id, []),
                "work_experience": profile_row.get("work_experience") if isinstance(profile_row.get("work_experience"), list) else [],
                "education": profile_row.get("education") if isinstance(profile_row.get("education"), list) else [],
                "certifications": profile_row.get("certifications") if isinstance(profile_row.get("certifications"), list) else [],
                "risk_flags": profile_row.get("risk_flags") if isinstance(profile_row.get("risk_flags"), list) else [],
                "extraction_confidence": profile_row.get("extraction_confidence") if isinstance(profile_row.get("extraction_confidence"), dict) else {"overall": 0.6},
                "evidence_spans": parser_raw.get("evidence_spans") if isinstance(parser_raw.get("evidence_spans"), list) else [],
            }
            match_output = build_match_output(profile_payload, job_requirement_payload, match_weights)
            match_row = db.first(
                client.table("candidate_position_matches")
                .insert(
                    [
                        {
                            "candidate_id": candidate_id,
                            "position_id": position["id"],
                            "profile_id": profile_id or None,
                            "job_requirement_id": job_requirement_id,
                            "resume_upload_id": profile_row.get("resume_upload_id"),
                            "overall_score": match_output["overall_score"],
                            "recommendation": match_output["recommendation"],
                            "must_have_match_score": match_output["must_have_match_score"],
                            "skill_match_score": match_output["skill_match_score"],
                            "project_relevance_score": match_output["project_relevance_score"],
                            "experience_match_score": match_output["experience_match_score"],
                            "education_match_score": match_output["education_match_score"],
                            "matched_skills": match_output["matched_skills"],
                            "missing_skills": match_output["missing_skills"],
                            "matched_projects": match_output["matched_projects"],
                            "concerns": match_output["concerns"],
                            "summary_reason": match_output["summary_reason"],
                            "confidence": match_output["confidence"],
                            "evidence_links": match_output["evidence_links"],
                            "requirement_breakdown": match_output["requirement_breakdown"],
                            "human_decision": previous_match.get("human_decision"),
                            "review_note": previous_match.get("review_note"),
                            "reviewed_at": previous_match.get("reviewed_at"),
                            "reviewed_by": previous_match.get("reviewed_by"),
                            "llm_raw_json": {"mode": "historical-rule-only", "generated_at": now_iso()},
                            "prompt_version": "historical-rule-match-v1",
                            "model_version": "historical-rule-only",
                            "pipeline_version": "phase1-historical-rescreen-rule-only",
                        }
                    ]
                )
                .execute()
            )
            client.table("candidates").update(
                {
                    "p_id": position["id"],
                    "match": match_output["overall_score"],
                    "tag": recommendation_to_tag(match_output["recommendation"]),
                    "highlight": match_output["summary_reason"],
                }
            ).eq("id", candidate_id).execute()
            details.append(
                {
                    "candidateId": candidate_id,
                    "status": "rescored",
                    "matchId": str(match_row.get("id")) if match_row and match_row.get("id") else None,
                    "overallScore": match_output["overall_score"],
                }
            )
        except Exception as error:
            details.append({"candidateId": candidate_id, "status": "failed", "reason": str(error) if str(error) else "重筛失败"})

    return {
        "processed": len(candidate_ids),
        "rescored": len([item for item in details if item["status"] == "rescored"]),
        "skipped": len([item for item in details if item["status"] == "skipped"]),
        "failed": len([item for item in details if item["status"] == "failed"]),
        "details": details,
    }


@app.get("/api/interviews/{interview_id}/report")
def get_interview_report(interview_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any] | None:
    require_user(authorization)
    client = db.get_client()
    reports = db.many(
        client.table("interview_reports")
        .select("id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score,human_confirmed,human_confirmed_by,human_confirmed_at,generated_by,created_at,updated_at")
        .eq("interview_id", interview_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return reports[0] if reports else None


@app.get("/api/interviews/sessions/{session_id}")
def get_interview_session(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    session = db.first(client.table("interview_sessions").select("*").eq("id", session_id).limit(1).execute())
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/interviews/sessions/{session_id}/turns")
def get_interview_turns(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    turns = db.many(
        client.table("interview_turns")
        .select("id,session_id,turn_no,speaker,content,input_mode,latency_ms,tokens_in,tokens_out,confidence,metadata,created_by,created_at")
        .eq("session_id", session_id)
        .order("turn_no")
        .execute()
    )
    return {"items": turns}


@app.get("/api/interviews/candidates/{candidate_id}/position")
def get_candidate_position(candidate_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    candidate = db.first(client.table("candidates").select("p_id").eq("id", candidate_id).limit(1).execute())
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {"position_id": candidate.get("p_id")}


@app.post("/api/interviews/prepare")
def prepare_interview(payload: PrepareInterviewPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    interview = db.first(client.table("upcoming_interviews").select("id,status,candidate_id").eq("id", payload.interviewId).limit(1).execute())
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    candidate = db.first(client.table("candidates").select("id,name,title,prev_company,highlight").eq("id", payload.candidateId).limit(1).execute())
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    position = db.first(client.table("active_positions").select("id,title,department,technical_requirements,min_exp,min_edu").eq("id", payload.positionId).limit(1).execute())
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    parsed_profile = db.first(
        client.table("parsed_resume_profiles")
        .select("id,explicit_skills,inferred_skills,work_experience")
        .eq("candidate_id", payload.candidateId)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    resume_skills: list[str] = []
    resume_work_items: list[str] = []
    resume_projects: list[str] = []
    if parsed_profile:
        resume_skills = [*to_string_array(parsed_profile.get("explicit_skills")), *to_string_array(parsed_profile.get("inferred_skills"))][:12]
        resume_work_items = to_work_hints(parsed_profile.get("work_experience"))[:5]
        profile_id = normalize_text(parsed_profile.get("id"))
        if profile_id:
            parsed_projects = db.many(
                client.table("parsed_resume_projects")
                .select("project_name,project_summary,candidate_role,tech_stack")
                .eq("profile_id", profile_id)
                .order("project_index")
                .limit(4)
                .execute()
            )
            for project in parsed_projects:
                line = " / ".join(
                    part
                    for part in [
                        normalize_text(project.get("project_name")),
                        normalize_text(project.get("candidate_role")),
                        normalize_text(project.get("project_summary")),
                        f"技术栈: {'、'.join(to_string_array(project.get('tech_stack'))[:3])}" if to_string_array(project.get("tech_stack")) else "",
                    ]
                    if part
                )
                if line:
                    resume_projects.append(line)

    candidate_light = {**candidate, "resume_skills": resume_skills, "resume_projects": resume_projects, "resume_work_items": resume_work_items}
    question_plan = build_question_plan(candidate_light, position)
    requested_question_count = resolve_configured_interview_question_count(
        client,
        payload.questionCount if isinstance(payload.questionCount, int) and payload.questionCount > 0 else None,
    )
    if requested_question_count:
        question_plan = question_plan[:requested_question_count]
    skills = extract_skills_from_requirement(position.get("technical_requirements"))
    context_payload = {
        "candidate": {
            "id": candidate_light["id"],
            "name": candidate_light.get("name"),
            "title": candidate_light.get("title"),
            "prev_company": candidate_light.get("prev_company"),
            "resume_skills": resume_skills,
            "resume_projects": resume_projects,
            "resume_work_items": resume_work_items,
        },
        "position": {
            "id": position["id"],
            "title": position.get("title"),
            "department": position.get("department"),
            "min_exp": position.get("min_exp"),
            "min_edu": position.get("min_edu"),
        },
        "skills": skills,
            "rubric_version": "v2-core-and-personalized",
            "question_count": len(question_plan),
            "prepared_by": user["id"],
            "prepared_at": now_iso(),
        }

    existing_session = db.first(
        client.table("interview_sessions")
        .select("id,status,question_plan")
        .eq("interview_id", payload.interviewId)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    existing_status = normalize_text(existing_session.get("status")) if existing_session else ""
    preserve_active_session = existing_session and existing_status in {"running", "scoring"}
    if preserve_active_session:
        session_id = str(existing_session["id"])
        question_plan = existing_session.get("question_plan") if isinstance(existing_session.get("question_plan"), list) else question_plan
    elif existing_session and existing_status in {"preparing", "ready"}:
        client.table("interview_sessions").update(
            {
                "candidate_id": payload.candidateId,
                "position_id": payload.positionId,
                "mode": payload.mode,
                "status": "ready",
                "question_plan": question_plan,
                "context_payload": context_payload,
            }
        ).eq("id", existing_session["id"]).execute()
        session_id = str(existing_session["id"])
    else:
        inserted = db.first(
            client.table("interview_sessions")
            .insert(
                {
                    "interview_id": payload.interviewId,
                    "candidate_id": payload.candidateId,
                    "position_id": payload.positionId,
                    "mode": payload.mode,
                    "status": "ready",
                    "question_plan": question_plan,
                    "context_payload": context_payload,
                    "created_by": user["id"],
                }
            )
            .execute()
        )
        if not inserted:
            raise HTTPException(status_code=500, detail="Create session failed")
        session_id = str(inserted["id"])

    if not preserve_active_session:
        client.table("upcoming_interviews").update(
            {
                "candidate_id": payload.candidateId,
                "status": "ready",
                "session_id": session_id,
                "updated_by": user["id"],
            }
        ).eq("id", payload.interviewId).execute()

    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": session_id,
        "question_count": len(question_plan),
        "mode": payload.mode,
        "question_plan": question_plan,
    }


@app.post("/api/interviews/start")
def start_interview(payload: StartInterviewPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions")
        .select("id,interview_id,status,question_plan,started_at,candidate_id,position_id")
        .eq("id", payload.sessionId)
        .limit(1)
        .execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Session and interview mismatch")

    candidate_id = normalize_text(session.get("candidate_id"))
    position_id = normalize_text(session.get("position_id"))
    if not candidate_id or not position_id:
        raise HTTPException(status_code=400, detail="Session missing candidate_id or position_id")

    candidate = db.first(client.table("candidates").select("id,name,title,prev_company,highlight").eq("id", candidate_id).limit(1).execute())
    position = db.first(client.table("active_positions").select("id,title,department,technical_requirements,min_exp,min_edu").eq("id", position_id).limit(1).execute())
    if not candidate or not position:
        raise HTTPException(status_code=404, detail="Candidate or position not found")

    profile = db.first(
        client.table("parsed_resume_profiles")
        .select("id,explicit_skills,inferred_skills,work_experience,basic_profile,parser_raw_json")
        .eq("candidate_id", candidate_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    profile_id = normalize_text(profile.get("id")) if profile else ""
    projects = (
        db.many(
            client.table("parsed_resume_projects")
            .select("project_name,project_summary,candidate_role,tech_stack")
            .eq("profile_id", profile_id)
            .order("project_index")
            .limit(5)
            .execute()
        )
        if profile_id
        else []
    )
    parsed_requirement = db.first(
        client.table("parsed_job_requirements")
        .select("source_text,must_have_skills,nice_to_have_skills,core_responsibilities")
        .eq("position_id", position_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    session_question_plan = session.get("question_plan") if isinstance(session.get("question_plan"), list) else []
    requested_question_count = resolve_configured_interview_question_count(
        client,
        len(session_question_plan) if len(session_question_plan) > 0 else None,
    )

    try:
        agent_response = normalize_agent_runtime_response(agent_fetch(
            "/agent/start",
            {
                "session_id": payload.sessionId,
                "resume_text": build_resume_text(candidate, profile, projects),
                "jd_text": build_job_description_text(position, parsed_requirement),
                "candidate_profile": map_resume_context_to_candidate_profile(candidate, profile, projects),
                "job_profile": map_job_context_to_job_profile(position, parsed_requirement),
                "question_count": requested_question_count,
            },
        ))
    except HTTPException as exc:
        if exc.status_code < 500:
            raise
        try:
            agent_response = normalize_agent_runtime_response(
                agent_fetch(f"/agent/status?session_id={payload.sessionId}", method="GET")
            )
        except HTTPException:
            raise exc
        recovered_status = normalize_text(agent_response.get("status")).lower()
        recovered_message = normalize_text(agent_response.get("message"))
        if recovered_status in {"error", ""} or is_agent_system_error_message(recovered_message):
            raise exc
    if is_agent_session_exists_response(agent_response):
        agent_response = normalize_agent_runtime_response(
            agent_fetch(f"/agent/status?session_id={payload.sessionId}", method="GET")
        )
    if normalize_text(agent_response.get("status")).lower() == "error":
        raise HTTPException(status_code=502, detail=normalize_text(agent_response.get("message")) or "Agent start failed")

    mapped_plan = map_agent_plan_to_question_plan(agent_response.get("interview_plan"))
    opening_message = normalize_text(agent_response.get("message"))
    if not mapped_plan or is_agent_system_error_message(opening_message):
        detail = opening_message if is_agent_system_error_message(opening_message) else "Agent did not return an interview question plan."
        raise HTTPException(status_code=502, detail=detail)
    now = now_iso()
    client.table("interview_sessions").update(
        {
            "status": "running",
            "started_at": session.get("started_at") or now,
            "question_plan": mapped_plan,
        }
    ).eq("id", payload.sessionId).execute()

    interview = db.first(client.table("upcoming_interviews").select("id,started_at").eq("id", payload.interviewId).limit(1).execute())
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    client.table("upcoming_interviews").update(
        {
            "status": "in_progress",
            "session_id": payload.sessionId,
            "started_at": interview.get("started_at") or now,
            "updated_by": user["id"],
        }
    ).eq("id", payload.interviewId).execute()

    existing_ai_turns = db.many(
        client.table("interview_turns")
        .select("id,content,metadata")
        .eq("session_id", payload.sessionId)
        .eq("speaker", "ai")
        .execute()
    )
    reusable_ai_turn = next(
        (
            turn
            for turn in existing_ai_turns
            if normalize_text(turn.get("content")) and not is_agent_system_error_message(turn.get("content"))
        ),
        None,
    )
    first_question = normalize_text(reusable_ai_turn.get("content")) if reusable_ai_turn else None
    if not reusable_ai_turn and opening_message and not is_agent_system_error_message(opening_message):
        first_planned_question = ((agent_response.get("interview_plan") or {}).get("questions") or [{}])[0]
        client.table("interview_turns").insert(
            {
                "session_id": payload.sessionId,
                "turn_no": next_turn_no(payload.sessionId),
                "speaker": "ai",
                "content": opening_message,
                "input_mode": "text",
                "metadata": {
                    "kind": "question",
                    "question_id": "agent-1",
                    "topic": normalize_text(first_planned_question.get("topic")) if isinstance(first_planned_question, dict) else "",
                    "answer_guidance": normalize_text(first_planned_question.get("answer_guidance")) if isinstance(first_planned_question, dict) else "",
                    "source": "agent",
                    "step": 1,
                },
                "created_by": user["id"],
            }
        ).execute()
        first_question = opening_message

    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": payload.sessionId,
        "status": "running",
        "first_question": first_question,
        "question_count": len(mapped_plan),
        "agent_status": agent_response.get("status"),
    }


@app.post("/api/interviews/turn")
def append_turn(payload: AppendTurnPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions")
        .select("id,status,started_at,candidate_id,position_id,question_plan")
        .eq("id", payload.sessionId)
        .limit(1)
        .execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if normalize_text(session.get("status")) not in {"running", "ready"}:
        raise HTTPException(status_code=400, detail=f"Session status {session.get('status')} does not accept turns")

    if normalize_text(session.get("status")) == "ready":
        client.table("interview_sessions").update(
            {"status": "running", "started_at": session.get("started_at") or now_iso()}
        ).eq("id", payload.sessionId).execute()

    ai_reply = None
    agent_response = None
    asked_question_count = 0
    if payload.speaker == "candidate":
        all_turns = db.many(
            client.table("interview_turns")
            .select("id,turn_no,speaker,content,metadata")
            .eq("session_id", payload.sessionId)
            .order("turn_no")
            .execute()
        )
        asked_question_count = len(
            [
                turn
                for turn in all_turns
                if turn.get("speaker") == "ai"
                and isinstance(turn.get("metadata"), dict)
                and normalize_text(turn["metadata"].get("kind")) == "question"
            ]
        )

        agent_response = normalize_agent_runtime_response(agent_fetch(
            "/agent/answer",
            {
                "session_id": payload.sessionId,
                "user_answer": payload.content.strip(),
            },
        ))
        agent_status = normalize_text(agent_response.get("status")).lower()
        agent_message = normalize_text(agent_response.get("message"))
        if agent_status == "error" or is_agent_system_error_message(agent_message):
            detail = normalize_text(agent_response.get("message"))
            metadata = agent_response.get("metadata") if isinstance(agent_response.get("metadata"), dict) else {}
            detail = detail or normalize_text(metadata.get("error")) or "Agent rejected the candidate answer."
            raise HTTPException(status_code=409, detail=detail)

    inserted_turn = db.first(
        client.table("interview_turns")
        .insert(
            {
                "session_id": payload.sessionId,
                "turn_no": next_turn_no(payload.sessionId),
                "speaker": payload.speaker,
                "content": payload.content.strip(),
                "input_mode": payload.inputMode,
                "metadata": payload.metadata or {},
                "created_by": user["id"],
            }
        )
        .execute()
    )
    if not inserted_turn:
        raise HTTPException(status_code=500, detail="Insert turn failed")

    if payload.speaker == "candidate" and agent_response is not None:
        current_asked_count = int(((agent_response.get("state_snapshot") or {}).get("asked_question_count") or asked_question_count))
        agent_status = normalize_text(agent_response.get("status")).lower()
        ai_prompt = normalize_text(agent_response.get("message"))
        if is_agent_system_error_message(ai_prompt):
            raise HTTPException(status_code=409, detail=ai_prompt)
        ai_kind = "question" if current_asked_count > asked_question_count else "followup"
        if agent_status in {"wait_for_review", "finish"}:
            ai_prompt = ai_prompt or "The structured interview is complete. Scoring will start next."
            ai_kind = "closing"

        question_plan = session.get("question_plan") if isinstance(session.get("question_plan"), list) else []
        current_question_plan = (
            question_plan[current_asked_count - 1]
            if ai_kind == "question" and current_asked_count > 0 and current_asked_count - 1 < len(question_plan)
            else None
        )
        answer_guidance = normalize_text(current_question_plan.get("answer_guidance")) if isinstance(current_question_plan, dict) else ""

        if ai_prompt:
            inserted_ai_turn = db.first(
                client.table("interview_turns")
                .insert(
                    {
                        "session_id": payload.sessionId,
                        "turn_no": next_turn_no(payload.sessionId),
                        "speaker": "ai",
                        "content": ai_prompt,
                        "input_mode": "text",
                        "metadata": {
                            "kind": ai_kind,
                            "source": "agent",
                            "asked_question_count": current_asked_count,
                            "answer_count": int(((agent_response.get("state_snapshot") or {}).get("answer_count") or 0)),
                            "next_nodes": ((agent_response.get("state_snapshot") or {}).get("next_nodes") or []),
                            "answer_guidance": answer_guidance,
                        },
                        "created_by": user["id"],
                    }
                )
                .execute()
            )
            ai_reply = {
                "turn_no": int(inserted_ai_turn["turn_no"]) if inserted_ai_turn else next_turn_no(payload.sessionId) - 1,
                "content": ai_prompt,
                "kind": ai_kind,
            }

    candidate_turn_rows = db.many(
        client.table("interview_turns").select("id").eq("session_id", payload.sessionId).eq("speaker", "candidate").execute()
    )
    return {
        "ok": True,
        "session_id": payload.sessionId,
        "inserted_turn": inserted_turn,
        "ai_reply": ai_reply,
        "candidate_turn_count": len(candidate_turn_rows),
    }


@app.post("/api/interviews/finish")
def finish_interview(payload: FinishInterviewPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions").select("id,interview_id,status").eq("id", payload.sessionId).limit(1).execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Session and interview mismatch")

    agent_status = normalize_agent_runtime_response(agent_fetch(f"/agent/status?session_id={payload.sessionId}", method="GET"))
    state_snapshot = agent_status.get("state_snapshot") if isinstance(agent_status.get("state_snapshot"), dict) else {}
    next_nodes = state_snapshot.get("next_nodes") if isinstance(state_snapshot.get("next_nodes"), list) else []
    agent_response_status = normalize_text(agent_status.get("status")).lower()
    if agent_response_status == "ask" and "evaluate_answer" in next_nodes:
        turns = db.many(
            client.table("interview_turns")
            .select("id,turn_no,speaker,content,metadata")
            .eq("session_id", payload.sessionId)
            .order("turn_no")
            .execute()
        )
        last_ai_index = max((idx for idx, turn in enumerate(turns) if turn.get("speaker") == "ai"), default=-1)
        candidate_after_prompt = next(
            (
                turn
                for turn in reversed(turns[last_ai_index + 1 :])
                if turn.get("speaker") == "candidate" and normalize_text(turn.get("content"))
            ),
            None,
        )
        if not candidate_after_prompt:
            raise HTTPException(status_code=409, detail="Current question is waiting for a candidate answer.")
        recovered_response = normalize_agent_runtime_response(
            agent_fetch(
                "/agent/answer",
                {
                    "session_id": payload.sessionId,
                    "user_answer": normalize_text(candidate_after_prompt.get("content")),
                },
            )
        )
        recovered_state = recovered_response.get("state_snapshot") if isinstance(recovered_response.get("state_snapshot"), dict) else {}
        recovered_next_nodes = recovered_state.get("next_nodes") if isinstance(recovered_state.get("next_nodes"), list) else []
        recovered_status = normalize_text(recovered_response.get("status")).lower()
        if recovered_status == "ask" and "evaluate_answer" in recovered_next_nodes:
            raise HTTPException(status_code=409, detail="Agent is still processing the latest answer. Please retry submit after it finishes.")

    now = now_iso()
    client.table("interview_sessions").update({"status": "scoring", "ended_at": now}).eq("id", payload.sessionId).execute()
    client.table("upcoming_interviews").update(
        {
            "status": "completed",
            "ended_at": now,
            "session_id": payload.sessionId,
            "updated_by": user["id"],
        }
    ).eq("id", payload.interviewId).execute()

    turns = db.many(client.table("interview_turns").select("speaker").eq("session_id", payload.sessionId).execute())
    candidate_turns = len([turn for turn in turns if turn.get("speaker") == "candidate"])
    ai_turns = len([turn for turn in turns if turn.get("speaker") == "ai"])
    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": payload.sessionId,
        "status": "scoring",
        "candidate_turns": candidate_turns,
        "ai_turns": ai_turns,
    }


def normalize_proctoring_event(
    event: ProctoringEventPayload,
    interview_id: str,
    session_id: str,
    user_id: str,
) -> dict[str, Any]:
    event_type = normalize_text(event.eventType)
    if event_type not in PROCTORING_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid proctoring event type")

    severity = normalize_text(event.severity)
    if severity not in PROCTORING_SEVERITIES:
        raise HTTPException(status_code=400, detail="Invalid proctoring event severity")

    snapshot_paths = [normalize_text(path) for path in event.snapshotPaths if normalize_text(path)][:3]
    return {
        "interview_id": interview_id,
        "session_id": session_id,
        "event_type": event_type,
        "severity": severity,
        "confidence": max(0.0, min(1.0, to_number(event.confidence, 0.5))),
        "started_at": event.startedAt,
        "ended_at": event.endedAt,
        "duration_ms": max(0, int(to_number(event.durationMs, 0))),
        "snapshot_paths": snapshot_paths,
        "metadata": event.metadata or {},
        "created_by": user_id,
    }


@app.post("/api/interviews/proctoring-events")
def record_proctoring_events(
    payload: RecordProctoringEventsPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions")
        .select("id,interview_id")
        .eq("id", payload.sessionId)
        .limit(1)
        .execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Session and interview mismatch")

    rows = [
        normalize_proctoring_event(event, payload.interviewId, payload.sessionId, user["id"])
        for event in payload.events[:20]
    ]
    inserted_count = 0
    if rows:
        inserted = db.many(client.table("interview_proctoring_events").insert(rows).execute())
        inserted_count = len(inserted)

    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": payload.sessionId,
        "inserted_count": inserted_count,
    }


@app.post("/api/interviews/score")
def score_interview(payload: ScoreInterviewPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions").select("id,interview_id,candidate_id,status").eq("id", payload.sessionId).limit(1).execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Session and interview mismatch")

    agent_status = agent_fetch(f"/agent/status?session_id={payload.sessionId}", method="GET")
    response_payload = agent_status.get("response") if isinstance(agent_status.get("response"), dict) else {}
    final_report = response_payload.get("final_report") if isinstance(response_payload, dict) else None
    agent_response_status = normalize_text(response_payload.get("status")).lower() if isinstance(response_payload, dict) else ""

    if not isinstance(final_report, dict) and agent_response_status == "wait_for_review":
        reviewed_response = agent_fetch(
            "/agent/review",
            {
                "session_id": payload.sessionId,
                "approved": True,
                "comments": "Auto-approved by RecruitPro scoring flow.",
            },
        )
        final_report = reviewed_response.get("final_report") if isinstance(reviewed_response, dict) else None
        if not isinstance(final_report, dict):
            raise HTTPException(status_code=502, detail="Agent did not return a final report after review approval")

    if not isinstance(final_report, dict):
        turns = db.many(
            client.table("interview_turns")
            .select("id,turn_no,speaker,content,metadata")
            .eq("session_id", payload.sessionId)
            .order("turn_no")
            .execute()
        )
        final_report = build_recovered_report_from_turns(turns)
        if not isinstance(final_report, dict):
            raise HTTPException(status_code=502, detail="Agent did not return a final report for scoring")
    mapped = map_agent_report_to_interview_report(final_report)
    proctoring_events = db.many(
        client.table("interview_proctoring_events")
        .select("event_type,severity,confidence,started_at,ended_at,duration_ms,snapshot_paths,metadata,created_at")
        .eq("session_id", payload.sessionId)
        .order("created_at")
        .execute()
    )
    mapped = merge_proctoring_into_report(mapped, build_proctoring_summary(proctoring_events))
    report = db.first(
        client.table("interview_reports")
        .upsert(
            {
                "session_id": payload.sessionId,
                "interview_id": payload.interviewId,
                "candidate_id": session.get("candidate_id"),
                "overall_score": mapped["overall_score"],
                "dimension_scores": mapped["dimension_scores"],
                "strengths": mapped["strengths"],
                "risks": mapped["risks"],
                "recommendation": mapped["recommendation"],
                "evidence": mapped["evidence"],
                "summary": mapped["summary"],
                "risk_score": mapped["risk_score"],
                "generated_by": user["id"],
                "updated_at": now_iso(),
            },
            on_conflict="session_id",
        )
        .execute()
    )

    now = now_iso()
    client.table("interview_sessions").update({"status": "done", "ended_at": now}).eq("id", payload.sessionId).execute()
    client.table("upcoming_interviews").update(
        {
            "status": "completed",
            "ai_report_id": report.get("id") if report else None,
            "ended_at": now,
            "updated_by": user["id"],
        }
    ).eq("id", payload.interviewId).execute()

    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": payload.sessionId,
        "report": report,
    }


@app.post("/api/interviews/human-confirm")
def human_confirm(payload: HumanConfirmPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    report_row = db.first(
        client.table("interview_reports")
        .select("id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score")
        .eq("id", payload.reportId)
        .limit(1)
        .execute()
    )
    if not report_row:
        raise HTTPException(status_code=404, detail="Report not found")
    if str(report_row.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Report and interview mismatch")

    session_id = normalize_text(report_row.get("session_id"))
    if not session_id:
        raise HTTPException(status_code=400, detail="Report missing session_id")

    recommendation = payload.finalRecommendation or report_row.get("recommendation") or ("hire" if payload.confirmed else "reject")
    note = normalize_text(payload.note)
    summary = normalize_text(report_row.get("summary"))
    merged_summary = f"{summary}\n\nHuman review note: {note}".strip() if note else report_row.get("summary")
    now = now_iso()

    updated_report = db.first(
        client.table("interview_reports")
        .update(
            {
                "overall_score": report_row.get("overall_score"),
                "dimension_scores": report_row.get("dimension_scores"),
                "strengths": report_row.get("strengths"),
                "risks": report_row.get("risks"),
                "recommendation": recommendation,
                "evidence": report_row.get("evidence"),
                "summary": merged_summary,
                "risk_score": report_row.get("risk_score"),
                "human_confirmed": payload.confirmed,
                "human_confirmed_by": user["id"],
                "human_confirmed_at": now,
                "updated_at": now,
            }
        )
        .eq("id", payload.reportId)
        .execute()
    )

    client.table("interview_sessions").update({"status": "done", "ended_at": now}).eq("id", session_id).execute()
    client.table("upcoming_interviews").update(
        {
            "status": "completed",
            "ai_report_id": payload.reportId,
            "ended_at": now,
            "updated_by": user["id"],
        }
    ).eq("id", payload.interviewId).execute()

    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": session_id,
        "report": updated_report,
    }


def random_password(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@app.post("/api/interviews/room-password")
def room_password(payload: RoomPasswordPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    client = db.get_client()

    if payload.action == "issue":
        user = require_user(authorization)
        password = random_password(8)
        salt = secrets.token_hex(16)
        password_hash = sha256_hex(f"{password}:{salt}")
        client.table("upcoming_interviews").update(
            {
                "room_password": None,
                "room_password_hash": password_hash,
                "room_password_salt": salt,
                "room_password_set_at": now_iso(),
                "updated_by": user["id"],
            }
        ).eq("id", payload.interviewId).execute()
        return {"ok": True, "interview_id": payload.interviewId, "password": password}

    if payload.action == "verify":
        interview = db.first(
            client.table("upcoming_interviews")
            .select("id,room_password_hash,room_password_salt,room_password_set_at")
            .eq("id", payload.interviewId)
            .limit(1)
            .execute()
        )
        if not interview:
            raise HTTPException(status_code=404, detail="Interview not found")

        password_hash = normalize_text(interview.get("room_password_hash"))
        salt = normalize_text(interview.get("room_password_salt"))
        requires_password = bool(normalize_text(interview.get("room_password_set_at")) or password_hash)

        if not requires_password:
            return {"ok": True, "interview_id": payload.interviewId, "requires_password": False, "verified": True}

        input_password = normalize_text(payload.password)
        if not input_password:
            return {"ok": True, "interview_id": payload.interviewId, "requires_password": True, "verified": False}

        verified = hmac.compare_digest(sha256_hex(f"{input_password}:{salt}"), password_hash)
        return {"ok": True, "interview_id": payload.interviewId, "requires_password": True, "verified": verified}

    raise HTTPException(status_code=400, detail="Unsupported action")
