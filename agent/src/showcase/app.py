
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import streamlit as st
from dotenv import load_dotenv

# Ensure project root is importable even when streamlit is launched from other cwd.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

# Ensure environment variables are loaded before importing runtime/LLM modules.
load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)

_AGENT_IMPORT_ERROR: Optional[Exception] = None

try:
    from src.agent.api_schemas import AgentActionType
    from src.agent.runtime import InterviewAgentRuntime
except Exception as exc:  # pragma: no cover
    _AGENT_IMPORT_ERROR = exc


st.set_page_config(
    page_title="HireGraph AI Recruitment Workbench",
    page_icon="HG",
    layout="wide",
    initial_sidebar_state="expanded",
)


PAGE_KEYS = [
    "Dashboard",
    "Jobs",
    "Candidates",
    "Candidate Detail",
    "AI Interview",
    "Reports",
    "Settings",
]

CASE_OPTIONS = {
    "expert_rag": "Expert RAG Candidate",
    "generalist_python": "Python Generalist",
    "risk_inconsistent": "Risk-Inconsistent Candidate",
    "Custom": "Custom Input",
}

RISK_ORDER = {"Low": 1, "Medium": 2, "High": 3}


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');

        :root {
            --bg-1: #edf2ec;
            --bg-2: #e2e9e1;
            --surface: rgba(251, 253, 250, 0.93);
            --surface-strong: #ffffff;
            --line: rgba(25, 46, 31, 0.12);
            --text: #102114;
            --muted: #4f6254;
            --accent: #0f7b53;
            --accent-2: #0a5b3c;
            --focus: #1f9165;
            --radius-xl: 22px;
            --radius-lg: 16px;
            --radius-md: 12px;
            --shadow: 0 16px 40px rgba(26, 48, 30, 0.08);
            --shadow-soft: 0 10px 24px rgba(18, 42, 27, 0.07);
        }

        html, body, [class*="css"] {
            font-family: 'Space Grotesk', sans-serif;
            color-scheme: light;
            -webkit-tap-highlight-color: rgba(15, 123, 83, 0.2);
        }

        .stApp {
            background:
                radial-gradient(circle at 0% 0%, rgba(18, 142, 95, 0.12), transparent 26%),
                radial-gradient(circle at 90% 0%, rgba(94, 126, 86, 0.10), transparent 22%),
                linear-gradient(180deg, var(--bg-1), var(--bg-2));
            color: var(--text);
        }

        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #0d1812, #132117);
        }

        [data-testid="stSidebar"] * {
            color: #eef6ef;
        }

        .block-container {
            max-width: 1360px;
            padding-top: 1rem;
            padding-bottom: 2rem;
        }

        .page-shell {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow);
            padding: 1.2rem 1.2rem;
            margin-bottom: 1rem;
            content-visibility: auto;
        }

        .title-row {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.9rem;
        }

        .title-block h1 {
            margin: 0;
            font-size: clamp(1.55rem, 3vw, 2.35rem);
            line-height: 1.08;
            color: var(--text);
            text-wrap: balance;
        }

        .title-block p {
            margin: 0.35rem 0 0;
            color: var(--muted);
            font-size: 0.98rem;
            text-wrap: pretty;
        }

        .tag {
            display: inline-flex;
            align-items: center;
            border: 1px solid rgba(27, 127, 88, 0.2);
            background: rgba(27, 127, 88, 0.1);
            color: var(--accent-2);
            padding: 0.32rem 0.72rem;
            border-radius: 999px;
            font-weight: 600;
            font-size: 0.78rem;
            letter-spacing: 0.02em;
        }

        .detail-card {
            background: rgba(255, 255, 255, 0.82);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            padding: 0.82rem;
            margin-bottom: 0.65rem;
            box-shadow: var(--shadow-soft);
            content-visibility: auto;
        }

        .detail-card h4 {
            margin: 0 0 0.4rem;
            font-size: 0.95rem;
            color: var(--text);
        }

        .small-muted {
            color: var(--muted);
            font-size: 0.88rem;
            margin: 0;
        }

        .question-box {
            border: 1px solid rgba(27, 127, 88, 0.22);
            background: rgba(27, 127, 88, 0.08);
            border-radius: var(--radius-lg);
            padding: 0.95rem;
            margin-bottom: 0.8rem;
        }

        div[data-testid="stMetric"] {
            background: rgba(255, 255, 255, 0.84);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-soft);
            padding: 0.8rem 0.85rem;
        }

        div[data-testid="stMetricValue"] {
            font-variant-numeric: tabular-nums;
        }

        .stButton > button,
        .stDownloadButton > button {
            border: 1px solid rgba(15, 123, 83, 0.28);
            background: linear-gradient(180deg, #129162, #0f7b53);
            color: #f4fffa;
            border-radius: 999px;
            font-weight: 650;
            min-height: 2.75rem;
            box-shadow: 0 10px 22px rgba(13, 89, 61, 0.23);
            transition: transform 140ms ease, box-shadow 160ms ease, background-color 160ms ease;
            touch-action: manipulation;
        }

        .stButton > button:hover,
        .stDownloadButton > button:hover {
            transform: translateY(-1px);
            box-shadow: 0 14px 24px rgba(13, 89, 61, 0.27);
            background: linear-gradient(180deg, #1aa873, #11875d);
        }

        .stButton > button:active,
        .stDownloadButton > button:active {
            transform: translateY(0);
        }

        .stTextInput input,
        .stTextArea textarea,
        .stSelectbox [data-baseweb="select"] > div,
        .stChatInput textarea {
            border-radius: 12px;
            border-color: rgba(23, 58, 34, 0.19);
            background: rgba(255, 255, 255, 0.92);
        }

        .stDataFrame, [data-testid="stTable"] {
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid var(--line);
            box-shadow: var(--shadow-soft);
        }

        .stButton > button:focus-visible,
        .stDownloadButton > button:focus-visible,
        .stTextInput input:focus-visible,
        .stTextArea textarea:focus-visible,
        .stSelectbox [data-baseweb="select"] > div:focus-within,
        .stChatInput textarea:focus-visible {
            outline: 3px solid rgba(31, 145, 101, 0.32);
            outline-offset: 2px;
            border-color: var(--focus);
        }

        @media (prefers-reduced-motion: reduce) {
            .stButton > button,
            .stDownloadButton > button {
                transition: none;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_case(case_name: str) -> Tuple[str, str]:
    if case_name == "Custom":
        return "", ""

    base_dir = Path(__file__).resolve().parents[2]
    case_dir = base_dir / "data" / "cases" / case_name
    resume_text = ""
    jd_text = ""

    if not case_dir.exists():
        return resume_text, jd_text

    for file_path in case_dir.iterdir():
        lower = file_path.name.lower()
        text = file_path.read_text(encoding="utf-8")
        if "resume" in lower:
            resume_text = text
        elif "jd" in lower or "case_data" in lower:
            jd_text = text

    return resume_text, jd_text


def init_session() -> None:
    if _AGENT_IMPORT_ERROR is not None:
        return

    if "runtime" not in st.session_state:
        st.session_state.runtime = InterviewAgentRuntime()

    if "sessions" not in st.session_state:
        st.session_state.sessions = {}

    if "active_thread_id" not in st.session_state:
        st.session_state.active_thread_id = None

    if "draft_case" not in st.session_state:
        st.session_state.draft_case = "expert_rag"

    if "draft_resume" not in st.session_state:
        resume, jd = load_case(st.session_state.draft_case)
        st.session_state.draft_resume = resume
        st.session_state.draft_jd = jd

    if "draft_label" not in st.session_state:
        st.session_state.draft_label = "Priority Candidate"


def case_changed_handler() -> None:
    case_name = st.session_state.get("draft_case", "Custom")
    resume, jd = load_case(case_name)
    if case_name != "Custom":
        st.session_state.draft_resume = resume
        st.session_state.draft_jd = jd


def infer_status_from_next(next_nodes: Tuple[str, ...]) -> str:
    if not next_nodes:
        return "finish"
    if "request_human_review" in next_nodes or "finalize_report" in next_nodes:
        return "wait_for_review"
    return "ask"


def stage_from_state(next_nodes: Tuple[str, ...], values: Dict[str, Any]) -> str:
    status = infer_status_from_next(next_nodes)
    if status == "finish":
        return "Completed"
    if status == "wait_for_review":
        return "Pending HR Review"
    plan = values.get("interview_plan")
    asked = values.get("asked_questions", [])
    if plan and len(asked) > 0:
        return "Interview In Progress"
    if values.get("gap_analysis"):
        return "Planning"
    return "Analysis"


def get_runtime_snapshot(thread_id: str) -> Optional[Dict[str, Any]]:
    runtime = st.session_state.runtime
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state = runtime.graph.get_state(config)
    except Exception:
        return None

    values = state.values or {}
    next_nodes = tuple(state.next or ())
    return {
        "values": values,
        "next_nodes": next_nodes,
        "status": infer_status_from_next(next_nodes),
        "stage": stage_from_state(next_nodes, values),
    }


def extract_risk_level(values: Dict[str, Any]) -> str:
    audit = values.get("audit_result")
    if not audit or not getattr(audit, "risks", None):
        return "Low"
    max_level = "Low"
    for risk in audit.risks:
        level = risk.risk_level.value
        if RISK_ORDER[level] > RISK_ORDER[max_level]:
            max_level = level
    return max_level


def build_session_summary(thread_id: str, meta: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = get_runtime_snapshot(thread_id)
    values: Dict[str, Any] = snapshot["values"] if snapshot else {}
    stage = snapshot["stage"] if snapshot else "Not Started"

    candidate = values.get("candidate_profile")
    job = values.get("job_profile")
    gap = values.get("gap_analysis")
    report = values.get("final_report")

    candidate_name = candidate.name if candidate else meta.get("label") or "Unnamed Candidate"
    role = job.title if job else "-"

    fit_score = gap.overall_fit_score if gap else None
    final_score = report.overall_score if report else None
    recommendation = report.hire_recommendation.value if report else "-"
    risk = extract_risk_level(values)

    return {
        "thread_id": thread_id,
        "candidate": candidate_name,
        "role": role,
        "stage": stage,
        "fit_score": fit_score,
        "final_score": final_score,
        "risk": risk,
        "recommendation": recommendation,
        "updated_at": meta.get("updated_at", "-"),
        "source_case": meta.get("source_case", "Custom"),
    }


def all_session_summaries() -> List[Dict[str, Any]]:
    sessions = st.session_state.sessions
    summaries = [build_session_summary(tid, meta) for tid, meta in sessions.items()]
    summaries.sort(key=lambda row: row.get("updated_at", ""), reverse=True)
    return summaries

def start_screening_session(label: str, resume_text: str, jd_text: str, source_case: str) -> Tuple[bool, str]:
    if not resume_text.strip() or not jd_text.strip():
        return False, "Resume and JD are both required."

    thread_id = str(uuid.uuid4())
    try:
        st.session_state.runtime.start_interview(
            resume_text=resume_text,
            jd_text=jd_text,
            thread_id=thread_id,
        )
    except RuntimeError as exc:
        return False, f"Runtime rejected session start: {exc}"
    except Exception as exc:
        return False, f"Unexpected error while starting session: {exc}"

    st.session_state.sessions[thread_id] = {
        "label": label.strip() or "Candidate Session",
        "resume_text": resume_text,
        "jd_text": jd_text,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "source_case": source_case,
    }
    st.session_state.active_thread_id = thread_id
    return True, thread_id


def update_session_timestamp(thread_id: str) -> None:
    if thread_id in st.session_state.sessions:
        st.session_state.sessions[thread_id]["updated_at"] = now_iso()


def submit_candidate_answer(thread_id: str, answer: str) -> Optional[str]:
    if not answer.strip():
        return "Answer cannot be empty."
    try:
        response = st.session_state.runtime.submit_answer(thread_id=thread_id, user_answer=answer)
        if response.status == AgentActionType.ERROR:
            return response.message or "Failed to submit answer."
        update_session_timestamp(thread_id)
        return None
    except Exception as exc:
        return f"Failed to submit answer: {exc}"


def submit_hr_review(thread_id: str, approved: bool, comments: str) -> Optional[str]:
    try:
        response = st.session_state.runtime.submit_human_review(
            thread_id=thread_id,
            approved=approved,
            comments=comments,
        )
        if response.status == AgentActionType.ERROR:
            return response.message or "Failed to submit HR review."
        update_session_timestamp(thread_id)
        return None
    except Exception as exc:
        return f"Failed to submit HR review: {exc}"


def active_snapshot() -> Optional[Dict[str, Any]]:
    thread_id = st.session_state.active_thread_id
    if not thread_id:
        return None
    snapshot = get_runtime_snapshot(thread_id)
    if snapshot is None:
        return None
    snapshot["thread_id"] = thread_id
    return snapshot


def render_page_header(title: str, subtitle: str, badge: str) -> None:
    st.markdown(
        f"""
        <div class="page-shell">
            <div class="title-row">
                <div class="title-block">
                    <h1>{title} <span style="font-size:0.56em; color:#0f7b53; border:1px solid rgba(15,123,83,0.3); padding:0.14rem 0.42rem; border-radius:999px; vertical-align:middle;">UI REFRESH v2</span></h1>
                    <p>{subtitle}</p>
                </div>
                <span class="tag">{badge}</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def sidebar_controls() -> str:
    st.sidebar.markdown("## HireGraph Workbench")
    st.sidebar.caption("Emerald Interface · 2026.04")
    page = st.sidebar.radio("Navigate", options=PAGE_KEYS, index=0)

    if _AGENT_IMPORT_ERROR is not None:
        st.sidebar.error("Agent runtime import failed.")
        st.sidebar.caption(repr(_AGENT_IMPORT_ERROR))
        return page

    summaries = all_session_summaries()
    session_labels = {
        row["thread_id"]: f"{row['candidate']} | {row['stage']}"
        for row in summaries
    }

    st.sidebar.markdown("---")
    if summaries:
        active = st.session_state.active_thread_id or summaries[0]["thread_id"]
        selected = st.sidebar.selectbox(
            "Active Session",
            options=[row["thread_id"] for row in summaries],
            index=[row["thread_id"] for row in summaries].index(active)
            if active in [row["thread_id"] for row in summaries]
            else 0,
            format_func=lambda tid: session_labels.get(tid, tid[:8]),
        )
        st.session_state.active_thread_id = selected
    else:
        st.sidebar.caption("No sessions yet. Start one from Jobs page.")

    st.sidebar.markdown("---")
    st.sidebar.caption("Runtime")
    st.sidebar.write(f"Mode: `{os.getenv('AGENT_MODE', 'dev')}`")
    st.sidebar.write(f"Provider: `{os.getenv('LLM_PROVIDER', 'openai')}`")
    st.sidebar.write(f"Model: `{os.getenv('LLM_MODEL', 'gpt-4o-mini')}`")
    st.sidebar.write(f"LangSmith: `{os.getenv('LANGSMITH_TRACING', 'false')}`")

    return page


def render_dashboard() -> None:
    render_page_header(
        "AI Recruitment Operations Dashboard",
        "Track screening volume, interview progress, risk exposure, and recommendation outcomes from the live LangGraph workflow.",
        "Workflow Intelligence",
    )

    summaries = all_session_summaries()
    if not summaries:
        st.info("No screening sessions yet. Go to Jobs and launch an AI screening run.")
        return

    total = len(summaries)
    completed = sum(1 for row in summaries if row["stage"] == "Completed")
    in_review = sum(1 for row in summaries if row["stage"] == "Pending HR Review")
    high_risk = sum(1 for row in summaries if row["risk"] == "High")

    fit_values = [row["fit_score"] for row in summaries if row["fit_score"] is not None]
    avg_fit = round(sum(fit_values) / len(fit_values), 1) if fit_values else 0

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total Sessions", total)
    c2.metric("Completed", completed)
    c3.metric("Pending Review", in_review)
    c4.metric("High Risk", high_risk)
    c5.metric("Avg Fit", f"{avg_fit}%")

    st.markdown("### Pipeline View")
    left, right = st.columns([1.3, 1.7])

    with left:
        distribution = {}
        for row in summaries:
            distribution[row["stage"]] = distribution.get(row["stage"], 0) + 1
        stage_rows = [{"Stage": k, "Count": v} for k, v in distribution.items()]
        st.dataframe(stage_rows, use_container_width=True, hide_index=True)

    with right:
        st.markdown("#### Live Sessions")
        for row in summaries[:8]:
            score = row["final_score"] if row["final_score"] is not None else row["fit_score"]
            st.markdown(
                f"""
                <div class="detail-card">
                    <h4>{row['candidate']}</h4>
                    <p class="small-muted">{row['role']} | {row['stage']} | Risk: {row['risk']}</p>
                    <p class="small-muted">Recommendation: {row['recommendation']} | Score: {score if score is not None else '-'}</p>
                </div>
                """,
                unsafe_allow_html=True,
            )


def render_jobs_page() -> None:
    render_page_header(
        "Job Intake and Screening Launch",
        "Map role requirements and candidate documents to the backend interview graph. Start a full parse->audit->plan run from one control surface.",
        "Job + Intake",
    )

    left, right = st.columns([1.4, 1.0], gap="large")

    with left:
        st.markdown("### Intake Workspace")
        st.selectbox(
            "Case Preset",
            options=list(CASE_OPTIONS.keys()),
            key="draft_case",
            format_func=lambda x: CASE_OPTIONS[x],
            on_change=case_changed_handler,
        )
        st.text_input("Session Label", key="draft_label")
        st.text_area("Job Description", key="draft_jd", height=230)
        st.text_area("Candidate Resume", key="draft_resume", height=230)

        if st.button("Launch AI Screening", type="primary", use_container_width=True):
            ok, message = start_screening_session(
                label=st.session_state.draft_label,
                resume_text=st.session_state.draft_resume,
                jd_text=st.session_state.draft_jd,
                source_case=st.session_state.draft_case,
            )
            if ok:
                st.success(f"Session started: {message[:8]}")
                st.rerun()
            else:
                st.error(message)

    with right:
        st.markdown("### Active Job Snapshot")
        snap = active_snapshot()
        if not snap:
            st.info("No active session yet.")
            return

        values = snap["values"]
        job = values.get("job_profile")
        gap = values.get("gap_analysis")

        if not job:
            st.caption("Job profile will appear after parse_jd node runs.")
        else:
            st.metric("Role", job.title)
            st.metric("Required Experience", f"{job.experience_years} years")
            st.markdown("**Required Skills**")
            st.write(", ".join(job.required_skills) if job.required_skills else "-")
            st.markdown("**Key Responsibilities**")
            for item in job.key_responsibilities[:6]:
                st.write(f"- {item}")

        if gap:
            st.markdown("---")
            st.metric("Current Fit Score", f"{gap.overall_fit_score}%")
            st.caption("Focus Areas")
            for area in gap.focus_areas:
                st.write(f"- {area}")

def render_candidates_page() -> None:
    render_page_header(
        "Candidate Pipeline",
        "View every screening thread as a candidate record with fit, stage, risk, recommendation, and action readiness.",
        "Candidate Ops",
    )

    summaries = all_session_summaries()
    if not summaries:
        st.info("No candidate sessions available.")
        return

    c1, c2, c3 = st.columns(3)
    stage_filter = c1.selectbox("Stage", options=["All"] + sorted({s["stage"] for s in summaries}))
    risk_filter = c2.selectbox("Risk", options=["All", "Low", "Medium", "High"])
    source_filter = c3.selectbox("Source", options=["All"] + sorted({s["source_case"] for s in summaries}))

    filtered = []
    for row in summaries:
        if stage_filter != "All" and row["stage"] != stage_filter:
            continue
        if risk_filter != "All" and row["risk"] != risk_filter:
            continue
        if source_filter != "All" and row["source_case"] != source_filter:
            continue
        filtered.append(row)

    st.dataframe(
        [
            {
                "Candidate": row["candidate"],
                "Role": row["role"],
                "Stage": row["stage"],
                "Fit": row["fit_score"],
                "Final Score": row["final_score"],
                "Risk": row["risk"],
                "Recommendation": row["recommendation"],
                "Updated": row["updated_at"],
                "Thread": row["thread_id"][:8],
            }
            for row in filtered
        ],
        use_container_width=True,
        hide_index=True,
    )

    thread_map = {f"{row['candidate']} ({row['thread_id'][:8]})": row["thread_id"] for row in filtered}
    selected_label = st.selectbox("Open Candidate", options=list(thread_map.keys()))
    if st.button("Set As Active Candidate", use_container_width=True):
        st.session_state.active_thread_id = thread_map[selected_label]
        st.success("Active candidate switched.")


def render_candidate_detail() -> None:
    render_page_header(
        "Candidate Intelligence Profile",
        "Deep drill into parsed profile, role alignment, interview plan, risk audit, and evidence-backed recommendation context.",
        "Candidate 360",
    )

    snap = active_snapshot()
    if not snap:
        st.info("Select an active candidate from sidebar or Candidates page.")
        return

    values = snap["values"]
    candidate = values.get("candidate_profile")
    job = values.get("job_profile")
    gap = values.get("gap_analysis")
    audit = values.get("audit_result")
    research = values.get("research_notes", [])
    plan = values.get("interview_plan")
    report = values.get("final_report")

    tabs = st.tabs(["Profile", "Role Match", "Risk & Research", "Interview Trace", "Report Context"])

    with tabs[0]:
        if not candidate:
            st.caption("Candidate profile is not ready yet.")
        else:
            m1, m2, m3 = st.columns(3)
            m1.metric("Candidate", candidate.name)
            m2.metric("Experience", f"{candidate.experience_years} years")
            m3.metric("Education", candidate.education_level or "-")

            st.markdown("**Skills**")
            st.write(", ".join(candidate.skills) if candidate.skills else "-")
            st.markdown("**Recent Roles**")
            for role in candidate.recent_roles[:6]:
                st.write(f"- {role}")
            st.markdown("**Key Achievements**")
            for item in candidate.key_achievements[:8]:
                st.write(f"- {item}")

    with tabs[1]:
        if not job:
            st.caption("Job profile not ready.")
        else:
            st.markdown("**Target Role**")
            st.write(job.title)
            st.markdown("**Required Skills**")
            st.write(", ".join(job.required_skills) if job.required_skills else "-")

        if gap:
            c1, c2, c3 = st.columns(3)
            c1.metric("Fit Score", f"{gap.overall_fit_score}%")
            c2.metric("Experience Gap", f"{gap.experience_gap_years:.1f} years")
            c3.metric("Focus Topics", len(gap.focus_areas))

            st.markdown("**Matching Skills**")
            st.write(", ".join(gap.matching_skills) if gap.matching_skills else "-")
            st.markdown("**Missing Skills**")
            st.write(", ".join(gap.missing_skills) if gap.missing_skills else "-")
            st.markdown("**AI Focus Areas**")
            for area in gap.focus_areas:
                st.write(f"- {area}")

    with tabs[2]:
        if not audit:
            st.caption("Audit result not generated yet.")
        else:
            st.info(audit.summary)
            for idx, risk in enumerate(audit.risks, 1):
                with st.expander(f"Risk {idx}: {risk.category} ({risk.risk_level.value})"):
                    st.write(risk.description)

        st.markdown("**Research Notes**")
        if research:
            for note in research:
                st.write(f"- {note}")
        else:
            st.caption("No research notes yet.")

    with tabs[3]:
        asked = values.get("asked_questions", [])
        answers = values.get("answers", [])
        evals = values.get("partial_scores", [])

        c1, c2, c3 = st.columns(3)
        c1.metric("Asked Questions", len(asked))
        c2.metric("Answers", len(answers))
        c3.metric("Evaluations", len(evals))

        if plan:
            st.markdown("**Planned Questions**")
            for i, q in enumerate(plan.questions, 1):
                asked_flag = "Asked" if i <= len(asked) else "Pending"
                st.write(f"{i}. [{asked_flag}] {q.topic}: {q.question_text}")

        if evals:
            st.markdown("**Evaluation Log**")
            for idx, ev in enumerate(evals[-5:], 1):
                st.markdown(
                    f"""
                    <div class="detail-card">
                        <h4>Evaluation #{idx}</h4>
                        <p class="small-muted">Tech {ev.dimensions.technical_depth}/10 | Logic {ev.dimensions.communication_logic}/10 | Problem {ev.dimensions.problem_solving}/10</p>
                        <p>{ev.feedback}</p>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

    with tabs[4]:
        if report:
            st.metric("Final Recommendation", report.hire_recommendation.value)
            st.metric("Final Score", f"{report.overall_score}/100")

            left, right = st.columns(2)
            with left:
                st.markdown("**Strengths**")
                for item in report.strengths:
                    source = f"Q{item.source_question_index + 1}" if item.source_question_index >= 0 else "General"
                    st.write(f"- {item.claim} ({source})")
            with right:
                st.markdown("**Weaknesses**")
                for item in report.weaknesses:
                    source = f"Q{item.source_question_index + 1}" if item.source_question_index >= 0 else "General"
                    st.write(f"- {item.claim} ({source})")
        else:
            st.caption("Final report is not available yet.")


def render_ai_interview() -> None:
    render_page_header(
        "AI Interview Console",
        "Operate the live interview loop: question delivery, candidate answer intake, evaluator feedback, and human review handoff.",
        "Interview Runtime",
    )

    snap = active_snapshot()
    if not snap:
        st.info("No active session. Start from Jobs page.")
        return

    thread_id = snap["thread_id"]
    values = snap["values"]
    next_nodes = snap["next_nodes"]
    status = snap["status"]

    plan = values.get("interview_plan")
    asked = values.get("asked_questions", [])
    evals = values.get("partial_scores", [])
    messages = values.get("messages", [])

    progress_den = len(plan.questions) if plan else max(len(asked), 1)
    progress = min(len(asked) / progress_den, 1.0) if progress_den else 0

    left, right = st.columns([1.3, 1.0], gap="large")

    with left:
        st.progress(progress, text=f"Interview Progress: {len(asked)}/{progress_den} questions")

        current_question = messages[-1].content if messages else "Awaiting next question."
        st.markdown(
            f"""
            <div class="question-box">
                <strong>AI Question / Prompt</strong>
                <p style="margin:0.4rem 0 0;">{current_question}</p>
            </div>
            """,
            unsafe_allow_html=True,
        )

        if status == "ask":
            answer = st.chat_input("Submit candidate answer")
            if answer is not None:
                err = submit_candidate_answer(thread_id, answer)
                if err:
                    st.error(err)
                else:
                    st.rerun()

        elif status == "wait_for_review":
            st.warning("Session paused for HR review before final recommendation.")
            review_comments = st.text_area(
                "Reviewer Comments",
                value="Approved by interviewer console.",
                key=f"review_comments_{thread_id}",
                height=120,
            )
            a, b = st.columns(2)
            if a.button("Approve", use_container_width=True):
                err = submit_hr_review(thread_id, True, review_comments)
                if err:
                    st.error(err)
                else:
                    st.rerun()
            if b.button("Reject", use_container_width=True):
                err = submit_hr_review(thread_id, False, review_comments)
                if err:
                    st.error(err)
                else:
                    st.rerun()

        else:
            st.success("Interview completed. Final report available in Reports.")

    with right:
        candidate = values.get("candidate_profile")
        job = values.get("job_profile")
        gap = values.get("gap_analysis")
        last_eval = evals[-1] if evals else None

        st.markdown("### Context Panel")
        st.markdown(
            f"""
            <div class="detail-card">
                <h4>Candidate</h4>
                <p class="small-muted">{candidate.name if candidate else '-'}</p>
                <h4>Role</h4>
                <p class="small-muted">{job.title if job else '-'}</p>
                <h4>Fit Score</h4>
                <p class="small-muted">{f"{gap.overall_fit_score}%" if gap else '-'}</p>
                <h4>Next Node(s)</h4>
                <p class="small-muted">{', '.join(next_nodes) if next_nodes else 'END'}</p>
            </div>
            """,
            unsafe_allow_html=True,
        )

        if last_eval:
            st.markdown("### Latest AI Evaluation")
            c1, c2, c3 = st.columns(3)
            c1.metric("Tech", f"{last_eval.dimensions.technical_depth}/10")
            c2.metric("Logic", f"{last_eval.dimensions.communication_logic}/10")
            c3.metric("Solve", f"{last_eval.dimensions.problem_solving}/10")
            if last_eval.missing_logic_elements:
                st.warning("Missing elements: " + ", ".join(last_eval.missing_logic_elements))
            st.caption(last_eval.feedback)

def render_reports_page() -> None:
    render_page_header(
        "Final Reports and Recommendations",
        "Access completed interview reports with evidence-backed strengths, weaknesses, scores, and hiring recommendations.",
        "Report Center",
    )

    summaries = [row for row in all_session_summaries() if row["stage"] == "Completed"]
    if not summaries:
        st.info("No completed sessions yet.")
        return

    label_to_thread = {
        f"{row['candidate']} | {row['recommendation']} | {row['thread_id'][:8]}": row["thread_id"]
        for row in summaries
    }
    selected = st.selectbox("Select Report", options=list(label_to_thread.keys()))
    thread_id = label_to_thread[selected]
    st.session_state.active_thread_id = thread_id

    snap = get_runtime_snapshot(thread_id)
    values = snap["values"] if snap else {}
    report = values.get("final_report")

    if not report:
        st.warning("Selected session has no final report payload.")
        return

    c1, c2, c3 = st.columns(3)
    c1.metric("Candidate", report.candidate_name)
    c2.metric("Score", f"{report.overall_score}/100")
    c3.metric("Recommendation", report.hire_recommendation.value)

    col_left, col_right = st.columns(2, gap="large")
    with col_left:
        st.markdown("### Strength Evidence")
        for item in report.strengths:
            source = f"Q{item.source_question_index + 1}" if item.source_question_index >= 0 else "General"
            st.write(f"- {item.claim} ({source})")
    with col_right:
        st.markdown("### Weakness Evidence")
        for item in report.weaknesses:
            source = f"Q{item.source_question_index + 1}" if item.source_question_index >= 0 else "General"
            st.write(f"- {item.claim} ({source})")

    st.markdown("### Structured Report")
    report_json = report.model_dump_json(indent=2)
    st.code(report_json, language="json")
    st.download_button(
        "Download JSON Report",
        data=report_json,
        file_name=f"report_{thread_id[:8]}.json",
        mime="application/json",
    )


def render_settings_page() -> None:
    render_page_header(
        "System and Governance Settings",
        "Inspect runtime mode, model provider, LangSmith tracing controls, and privacy posture used by the recruitment workflow.",
        "Ops + Governance",
    )

    mode = os.getenv("AGENT_MODE", "dev")
    provider = os.getenv("LLM_PROVIDER", "openai")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")

    tracing = os.getenv("LANGSMITH_TRACING", "false")
    project = os.getenv("LANGSMITH_PROJECT", "-")
    hide_inputs = os.getenv("LANGSMITH_HIDE_INPUTS", "true")
    hide_outputs = os.getenv("LANGSMITH_HIDE_OUTPUTS", "true")

    c1, c2, c3 = st.columns(3)
    c1.metric("Agent Mode", mode)
    c2.metric("Provider", provider)
    c3.metric("Model", model)

    st.markdown("### LangSmith Tracing")
    t1, t2, t3 = st.columns(3)
    t1.metric("Tracing Enabled", tracing)
    t2.metric("Project", project)
    t3.metric("Privacy Flags", f"in:{hide_inputs} / out:{hide_outputs}")

    st.markdown("### Backend Capability Map")
    st.write("- Runtime operations: `start_interview`, `submit_answer`, `submit_human_review`, `get_session_status`")
    st.write("- Graph stages: parse resume/jd -> audit -> research -> gap analysis -> plan -> ask/evaluate loop -> HR review -> final report")
    st.write("- Key entities: CandidateProfile, JobProfile, GapAnalysis, InterviewPlan, AnswerEvaluation, AuditResult, FinalInterviewReport")

    st.markdown("### Recommended .env")
    st.code(
        """AGENT_MODE=demo
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=hiregraph
LANGSMITH_HIDE_INPUTS=true
LANGSMITH_HIDE_OUTPUTS=true""",
        language="bash",
    )


def main() -> None:
    inject_styles()

    if _AGENT_IMPORT_ERROR is not None:
        st.error("Failed to import backend runtime components.")
        st.code(repr(_AGENT_IMPORT_ERROR))
        st.caption("Install dependencies and ensure PYTHONPATH includes project root.")
        return

    init_session()
    page = sidebar_controls()

    if page == "Dashboard":
        render_dashboard()
    elif page == "Jobs":
        render_jobs_page()
    elif page == "Candidates":
        render_candidates_page()
    elif page == "Candidate Detail":
        render_candidate_detail()
    elif page == "AI Interview":
        render_ai_interview()
    elif page == "Reports":
        render_reports_page()
    elif page == "Settings":
        render_settings_page()


if __name__ == "__main__":
    main()
