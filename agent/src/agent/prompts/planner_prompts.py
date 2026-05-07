"""Planner prompts: gap analysis and interview plan generation."""

from src.agent.interview_config import get_interview_question_config


GAP_ANALYSIS_PROMPT = """You are a technical hiring analyst.
Compare candidate profile and job profile, then produce structured gap analysis.

Return STRICT JSON only with these top-level keys exactly:
- matching_skills: string[]
- missing_skills: string[]
- experience_gap_years: number
- overall_fit_score: integer [0,100]
- focus_areas: string[] (2-4)

Rules:
1. All string values should be Simplified Chinese.
2. matching_skills = intersection of candidate skills and JD required skills.
3. missing_skills = JD required skills not evidenced by candidate profile.
4. experience_gap_years = candidate_years - required_years.
5. No extra keys.

Inputs:
- Job Profile: {job_profile_json}
- Candidate Profile: {candidate_profile_json}
"""


INTERVIEW_PLAN_PROMPT = """You are a senior technical interviewer.
Generate an interview plan from gap analysis and candidate evidence.

Difficulty level:
{difficulty_level}
{difficulty_instruction}

Candidate profile:
{candidate_profile_json}

Resume anchors (verifiable achievements):
{candidate_anchors}

Anchor count:
{anchor_count}

Return STRICT JSON only with these top-level keys exactly:
- questions: InterviewQuestion[]
- estimated_duration_minutes: integer

Each question item must contain exactly:
- topic: string
- question_text: string
- expected_key_points: string[]
- rendered_text: string
- answer_guidance: string

Hard constraints:
1. All string values must be Simplified Chinese.
2. Total questions must be {min_questions}-{max_questions}.
3. Every question must be scorable and verifiable.
4. If anchor_count > 0:
   - Q1 must explicitly reference at least one anchor fact (project name, metric, module, or result).
   - Do not say "信息不足" or "没有项目" if anchors exist.
5. expected_key_points must be concrete checklist items.
6. rendered_text must be concise, professional, directly askable.
7. answer_guidance must be concise, non-template, candidate-facing guidance tailored to that specific question.
8. Do not use fixed boilerplate like "至少覆盖3点"; write natural guidance based on the actual topic.
9. Do not fabricate candidate facts not present in candidate_profile_json or anchors.
10. Ensure coverage:
   - at least 1 question on role-critical skills from gap analysis
   - at least 1 question on practical problem solving
   - at least 1 question on experience/project execution when evidence exists

Input:
- Gap Analysis: {gap_analysis_json}
"""


def format_interview_plan_prompt(**kwargs) -> str:
    config = get_interview_question_config()
    return INTERVIEW_PLAN_PROMPT.format(
        min_questions=config.min_questions,
        max_questions=config.max_questions,
        **kwargs,
    )
