import { HttpError } from './http.ts';

export interface AgentLlmConfigPayload {
  provider: string;
  model: string;
  api_key?: string | null;
  base_url?: string | null;
}

export interface AgentCandidateProfilePayload {
  name: string;
  skills: string[];
  experience_years: number;
  recent_roles: string[];
  education_level?: string | null;
  key_achievements: string[];
}

export interface AgentJobProfilePayload {
  title: string;
  required_skills: string[];
  experience_years: number;
  key_responsibilities: string[];
}

export interface AgentGatewayResponse {
  status?: string;
  thread_id?: string;
  message?: string | null;
  interview_plan?: {
    questions?: Array<{
      topic?: string;
      question_text?: string;
      expected_key_points?: string[];
      rendered_text?: string;
      answer_guidance?: string;
    }>;
    estimated_duration_minutes?: number;
  } | null;
  final_report?: {
    candidate_name?: string;
    overall_score?: number;
    strengths?: Array<{ claim?: string; source_question_index?: number }>;
    weaknesses?: Array<{ claim?: string; source_question_index?: number }>;
    hire_recommendation?: string;
    detailed_evaluations?: Array<{
      question?: string;
      answer?: string;
      feedback?: string;
      dimensions?: {
        technical_depth?: number;
        communication_logic?: number;
        problem_solving?: number;
      };
      missing_logic_elements?: string[];
    }>;
  } | null;
  state_snapshot?: {
    asked_question_count?: number;
    answer_count?: number;
    planned_question_count?: number;
    next_nodes?: string[];
  } | null;
}

type AgentStatusPayload = {
  summary?: {
    ready?: boolean;
    overall_score?: number;
    decision?: string;
    strengths?: Array<{ claim?: string; source_question_index?: number }>;
    weaknesses?: Array<{ claim?: string; source_question_index?: number }>;
    detailed_log_count?: number;
  };
  response?: AgentGatewayResponse;
  state_snapshot?: AgentGatewayResponse['state_snapshot'];
};

export interface ResumeContextInput {
  candidate: {
    name?: string | null;
    title?: string | null;
    prev_company?: string | null;
    highlight?: string | null;
  };
  profile?: {
    explicit_skills?: unknown;
    inferred_skills?: unknown;
    work_experience?: unknown;
    basic_profile?: unknown;
    parser_raw_json?: unknown;
  } | null;
  projects?: Array<{
    project_name?: string | null;
    project_summary?: string | null;
    candidate_role?: string | null;
    tech_stack?: unknown;
  }>;
}

export interface JobContextInput {
  position: {
    title?: string | null;
    department?: string | null;
    technical_requirements?: string | null;
    min_exp?: number | null;
    min_edu?: string | null;
  };
  parsedRequirement?: {
    source_text?: string | null;
    must_have_skills?: unknown;
    nice_to_have_skills?: unknown;
    core_responsibilities?: unknown;
  } | null;
}

interface CompanyLlmSettingsRow {
  active_llm_model_id?: string | null;
  active_interview_llm_model_id?: string | null;
}

interface LlmModelConfigRow {
  id: string;
  provider: string;
  mode: string;
  model_name: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  is_active: boolean;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(500, `Missing required env: ${name}`);
  }
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const candidate =
          record.name ?? record.skill ?? record.value ?? record.label ?? record.summary ?? record.title ?? record.company;
        return typeof candidate === 'string' ? candidate.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeExperienceYears(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function mapProviderToAgentProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'google') return 'gemini';
  if (normalized === 'custom' || normalized === 'openrouter' || normalized === 'ollama' || normalized === 'vllm' || normalized === 'zhipu') {
    return 'manual_openai';
  }
  return normalized || 'openai';
}

async function fetchAgent<T>(path: string, init: RequestInit): Promise<T> {
  const baseUrl = getEnv('AGENT_BASE_URL').replace(/\/+$/, '');
  const sharedSecret = Deno.env.get('AGENT_SHARED_SECRET')?.trim() ?? '';
  const timeoutMs = Number(Deno.env.get('AGENT_TIMEOUT_MS') ?? '20000');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (sharedSecret) {
      headers.set('x-agent-secret', sharedSecret);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });

    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new HttpError(response.status || 502, `Agent gateway returned non-JSON response: ${raw.slice(0, 200)}`);
      }
    }

    if (!response.ok) {
      const detail =
        payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).detail === 'string'
          ? String((payload as Record<string, unknown>).detail)
          : payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
            ? String((payload as Record<string, unknown>).error)
            : `Agent gateway request failed with status ${response.status}`;
      throw new HttpError(response.status, detail);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new HttpError(504, 'Agent gateway timeout');
    }
    if (error instanceof Error) {
      throw new HttpError(502, `Agent gateway unavailable: ${error.message}`);
    }
    throw new HttpError(502, 'Agent gateway unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export function mapAgentPlanToQuestionPlan(interviewPlan: AgentGatewayResponse['interview_plan']): Array<Record<string, unknown>> {
  const questions = interviewPlan?.questions ?? [];
  return questions.map((question, index) => ({
    id: `agent-${index + 1}`,
    dimension: 'technical_depth',
    difficulty: 'medium',
    prompt: String(question?.rendered_text ?? question?.question_text ?? '').trim(),
    expected_signals: Array.isArray(question?.expected_key_points) ? question.expected_key_points : [],
    topic: String(question?.topic ?? '').trim(),
    answer_guidance: String(question?.answer_guidance ?? '').trim()
  }));
}

export function buildResumeText(input: ResumeContextInput): string {
  const explicitSkills = toStringArray(input.profile?.explicit_skills).slice(0, 12);
  const inferredSkills = toStringArray(input.profile?.inferred_skills).slice(0, 12);
  const workItems = toStringArray(input.profile?.work_experience).slice(0, 6);
  const projectLines = (input.projects ?? [])
    .slice(0, 5)
    .map((project) =>
      [
        project.project_name?.trim(),
        project.candidate_role?.trim(),
        project.project_summary?.trim(),
        toStringArray(project.tech_stack).slice(0, 5).join(' / ')
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .filter(Boolean);

  const preview =
    input.profile?.parser_raw_json &&
    typeof input.profile.parser_raw_json === 'object' &&
    typeof (input.profile.parser_raw_json as Record<string, unknown>).text_preview === 'string'
      ? ((input.profile.parser_raw_json as Record<string, unknown>).text_preview as string).trim()
      : '';

  return [
    `Candidate name: ${input.candidate.name ?? 'unknown'}`,
    `Current or target role: ${input.candidate.title ?? 'unknown'}`,
    `Previous company: ${input.candidate.prev_company ?? 'unknown'}`,
    `Highlight summary: ${input.candidate.highlight ?? 'none'}`,
    explicitSkills.length > 0 ? `Explicit skills: ${explicitSkills.join(', ')}` : '',
    inferredSkills.length > 0 ? `Inferred skills: ${inferredSkills.join(', ')}` : '',
    workItems.length > 0 ? `Work experience cues:\n- ${workItems.join('\n- ')}` : '',
    projectLines.length > 0 ? `Project experience:\n- ${projectLines.join('\n- ')}` : '',
    preview ? `Resume text preview:\n${preview}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function mapResumeContextToCandidateProfile(input: ResumeContextInput): AgentCandidateProfilePayload {
  const explicitSkills = toStringArray(input.profile?.explicit_skills).slice(0, 15);
  const inferredSkills = toStringArray(input.profile?.inferred_skills).slice(0, 10);
  const workItems = toStringArray(input.profile?.work_experience).slice(0, 5);
  const projectLines = (input.projects ?? [])
    .slice(0, 5)
    .map((project) =>
      [
        project.project_name?.trim(),
        project.candidate_role?.trim(),
        project.project_summary?.trim()
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .filter(Boolean);

  const basicProfile =
    input.profile?.basic_profile && typeof input.profile.basic_profile === 'object'
      ? (input.profile.basic_profile as Record<string, unknown>)
      : {};

  return {
    name: String(input.candidate.name ?? basicProfile.full_name ?? 'unknown').trim() || 'unknown',
    skills: [...new Set([...explicitSkills, ...inferredSkills])].slice(0, 20),
    experience_years: normalizeExperienceYears(basicProfile.years_of_experience),
    recent_roles: [
      String(input.candidate.title ?? basicProfile.current_title ?? '').trim(),
      ...workItems
    ].filter(Boolean).slice(0, 6),
    education_level: typeof basicProfile.education_level === 'string' ? basicProfile.education_level.trim() : null,
    key_achievements: [
      String(input.candidate.highlight ?? '').trim(),
      ...projectLines
    ].filter(Boolean).slice(0, 8)
  };
}

export function buildJobDescriptionText(input: JobContextInput): string {
  const mustHave = toStringArray(input.parsedRequirement?.must_have_skills).slice(0, 12);
  const niceToHave = toStringArray(input.parsedRequirement?.nice_to_have_skills).slice(0, 8);
  const responsibilities = toStringArray(input.parsedRequirement?.core_responsibilities).slice(0, 8);
  const sourceText = input.parsedRequirement?.source_text?.trim() ?? '';

  return [
    `Job title: ${input.position.title ?? 'unknown'}`,
    `Department: ${input.position.department ?? 'unknown'}`,
    `Minimum experience: ${input.position.min_exp ?? 'unknown'}`,
    `Minimum education: ${input.position.min_edu ?? 'unknown'}`,
    input.position.technical_requirements?.trim() ? `Technical requirements:\n${input.position.technical_requirements.trim()}` : '',
    mustHave.length > 0 ? `Must-have skills: ${mustHave.join(', ')}` : '',
    niceToHave.length > 0 ? `Nice-to-have skills: ${niceToHave.join(', ')}` : '',
    responsibilities.length > 0 ? `Core responsibilities:\n- ${responsibilities.join('\n- ')}` : '',
    sourceText ? `Job source text:\n${sourceText}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function mapJobContextToJobProfile(input: JobContextInput): AgentJobProfilePayload {
  const mustHave = toStringArray(input.parsedRequirement?.must_have_skills).slice(0, 15);
  const responsibilities = toStringArray(input.parsedRequirement?.core_responsibilities).slice(0, 8);

  return {
    title: String(input.position.title ?? 'unknown').trim() || 'unknown',
    required_skills: mustHave,
    experience_years: normalizeExperienceYears(input.position.min_exp),
    key_responsibilities: responsibilities
  };
}

export function mapAgentRecommendation(input: string | null | undefined): 'hire' | 'hold' | 'reject' | 'needs_review' {
  const value = String(input ?? '').trim().toLowerCase();
  if (value === 'strong hire' || value === 'hire') return 'hire';
  if (value === 'lean hire') return 'hold';
  if (value === 'no hire') return 'reject';
  return 'needs_review';
}

export function mapAgentReportToInterviewReport(finalReport: AgentGatewayResponse['final_report']): {
  overall_score: number | null;
  dimension_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
  recommendation: 'hire' | 'hold' | 'reject' | 'needs_review';
  evidence: Array<Record<string, unknown>>;
  summary: string;
  risk_score: number | null;
} {
  const evaluations = Array.isArray(finalReport?.detailed_evaluations) ? finalReport.detailed_evaluations : [];
  const strengths = Array.isArray(finalReport?.strengths)
    ? finalReport.strengths.map((item) => String(item?.claim ?? '').trim()).filter(Boolean)
    : [];
  const risks = Array.isArray(finalReport?.weaknesses)
    ? finalReport.weaknesses.map((item) => String(item?.claim ?? '').trim()).filter(Boolean)
    : [];

  const avg = (values: number[]): number => {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const technical = clamp(avg(evaluations.map((item) => Number(item?.dimensions?.technical_depth ?? 0))) * 10, 0, 100);
  const communication = clamp(avg(evaluations.map((item) => Number(item?.dimensions?.communication_logic ?? 0))) * 10, 0, 100);
  const problemSolving = clamp(avg(evaluations.map((item) => Number(item?.dimensions?.problem_solving ?? 0))) * 10, 0, 100);
  const overallScore = Number.isFinite(Number(finalReport?.overall_score)) ? Number(finalReport?.overall_score) : null;
  const recommendation = mapAgentRecommendation(finalReport?.hire_recommendation);
  const riskScore = overallScore === null ? null : clamp(100 - overallScore + risks.length * 8, 0, 100);

  const summaryLines = [
    `Recommendation: ${recommendation}. Overall score: ${overallScore ?? '-'}.`,
    strengths.length > 0 ? `Strengths: ${strengths.join('; ')}` : '',
    risks.length > 0 ? `Risks: ${risks.join('; ')}` : ''
  ].filter(Boolean);

  return {
    overall_score: overallScore,
    dimension_scores: {
      technical_depth: technical,
      communication,
      problem_solving: problemSolving
    },
    strengths,
    risks,
    recommendation,
    evidence: evaluations.map((item, index) => ({
      question_index: index,
      question: item?.question ?? '',
      answer: item?.answer ?? '',
      feedback: item?.feedback ?? '',
      missing_logic_elements: Array.isArray(item?.missing_logic_elements) ? item.missing_logic_elements : [],
      dimensions: item?.dimensions ?? {}
    })),
    summary: summaryLines.join('\n'),
    risk_score: riskScore
  };
}

export async function loadAgentLlmConfig(client: any): Promise<AgentLlmConfigPayload | null> {
  const { data: settingsData, error: settingsError } = await client
    .from('company_settings')
    .select('active_llm_model_id,active_interview_llm_model_id')
    .single();

  if (settingsError) {
    throw new HttpError(500, `Load interview agent settings failed: ${settingsError.message}`);
  }

  const settings = (settingsData ?? null) as CompanyLlmSettingsRow | null;
  const modelId = String(settings?.active_interview_llm_model_id ?? settings?.active_llm_model_id ?? '').trim();
  if (!modelId) return null;

  const { data: modelData, error: modelError } = await client
    .from('llm_model_configs')
    .select('id,provider,mode,model_name,base_url,api_key_encrypted,is_active')
    .eq('id', modelId)
    .eq('is_active', true)
    .single();

  if (modelError) {
    throw new HttpError(500, `Load interview agent model failed: ${modelError.message}`);
  }

  const model = (modelData ?? null) as LlmModelConfigRow | null;
  if (!model) return null;

  const mode = String(model.mode ?? '').trim().toLowerCase();
  const apiKey = String(model.api_key_encrypted ?? '').trim();

  return {
    provider: mapProviderToAgentProvider(String(model.provider ?? 'openai')),
    model: String(model.model_name ?? '').trim(),
    base_url: model.base_url?.trim() ?? null,
    api_key: apiKey || (mode === 'local' ? 'local-dev-key' : null)
  };
}

export async function invokeAgentStart(payload: {
  session_id: string;
  resume_text: string;
  jd_text: string;
  candidate_profile?: AgentCandidateProfilePayload | null;
  job_profile?: AgentJobProfilePayload | null;
  llm_config?: AgentLlmConfigPayload | null;
}): Promise<AgentGatewayResponse> {
  return await fetchAgent<AgentGatewayResponse>('/agent/start', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function invokeAgentAnswer(payload: {
  session_id: string;
  user_answer: string;
  llm_config?: AgentLlmConfigPayload | null;
}): Promise<AgentGatewayResponse> {
  return await fetchAgent<AgentGatewayResponse>('/agent/answer', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function invokeAgentReview(payload: {
  session_id: string;
  approved: boolean;
  comments: string;
  llm_config?: AgentLlmConfigPayload | null;
}): Promise<AgentGatewayResponse> {
  return await fetchAgent<AgentGatewayResponse>('/agent/review', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function invokeAgentStatus(sessionId: string): Promise<AgentStatusPayload> {
  const query = new URLSearchParams({ session_id: sessionId });
  return await fetchAgent<AgentStatusPayload>(`/agent/status?${query.toString()}`, {
    method: 'GET'
  });
}
