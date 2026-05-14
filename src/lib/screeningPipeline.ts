import { supabase } from './supabase';

type PipelineStage =
  | 'uploaded'
  | 'text_extraction'
  | 'profile_extraction'
  | 'matching'
  | 'completed'
  | 'failed';

type Recommendation = 'strong_match' | 'partial_match' | 'weak_match' | 'reject';

export interface ActivePositionRow {
  id: string;
  title: string;
  technical_requirements?: string | null;
  min_exp?: number | null;
  min_edu?: string | null;
  threshold_score?: number | null;
  department?: string | null;
  location?: string | null;
}

interface BasicProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  current_title: string | null;
  years_of_experience: number | null;
}

interface SkillItem {
  skill: string;
  confidence: number;
  evidence_span_ids: string[];
}

interface InferredSkillItem extends SkillItem {
  inference_reason: string;
}

interface EvidenceSpan {
  span_id: string;
  page_no: number | null;
  char_start: number;
  char_end: number;
  text_excerpt: string;
}

interface ParsedProject {
  project_name: string;
  project_summary: string;
  candidate_role: string | null;
  responsibilities: string[];
  tech_stack: string[];
  domain: string | null;
  complexity_level: 'low' | 'medium' | 'high' | 'unknown';
  leadership_level: 'aware' | 'used' | 'independent' | 'lead' | 'unknown';
  evidence_spans: string[];
  confidence: number;
}

interface ResumeProfilePayload {
  basic_profile: BasicProfile;
  explicit_skills: SkillItem[];
  inferred_skills: InferredSkillItem[];
  projects: ParsedProject[];
  work_experience: Array<Record<string, unknown>>;
  education: Array<Record<string, unknown>>;
  certifications: Array<Record<string, unknown>>;
  risk_flags: Array<Record<string, unknown>>;
  extraction_confidence: {
    overall: number;
    by_section: {
      projects: number;
      skills: number;
      education: number;
    };
  };
  evidence_spans: EvidenceSpan[];
}

interface ParsedJobRequirement {
  position_title: string;
  must_have_skills: Array<{ skill: string; min_level: string; min_years: number | null }>;
  nice_to_have_skills: Array<{ skill: string }>;
  required_experience_years: number | null;
  education_requirement: { min_level: string | null; is_strict: boolean };
  industry_preference: string[];
  project_keywords: string[];
  seniority_level: string;
  core_responsibilities: string[];
}

interface MatchOutput {
  overall_score: number;
  recommendation: Recommendation;
  must_have_match_score: number;
  skill_match_score: number;
  project_relevance_score: number;
  experience_match_score: number;
  education_match_score: number;
  matched_skills: string[];
  missing_skills: string[];
  matched_projects: Array<{ project_name: string; relevance_score: number; evidence_span_ids: string[] }>;
  concerns: string[];
  summary_reason: string;
  confidence: number;
  evidence_links: string[];
  requirement_breakdown: Array<{ requirement: string; status: 'met' | 'not_met' | 'unknown'; reason: string }>;
}

interface MatchWeightConfig {
  must_have: number;
  skills: number;
  project: number;
  experience: number;
  education: number;
}

export interface Phase1PipelineResult {
  candidateId: string;
  resumeUploadId: string;
  profileId: string;
  matchId: string;
  overallScore: number;
  recommendation: Recommendation;
}

export interface Phase1PipelineRunOptions {
  shouldCancel?: () => boolean;
}

export type PipelineProgressStage =
  | 'uploaded'
  | 'text_extraction'
  | 'profile_extraction'
  | 'matching'
  | 'completed'
  | 'failed';

type LlmMode = 'bootstrap' | 'local' | 'api_key';
type LlmProvider =
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'
  | 'vllm'
  | 'zhipu'
  | 'moonshot';
type LlmApiProtocol = 'openai' | 'anthropic' | 'gemini';

interface LlmRuntimeConfig {
  modelId: string | null;
  mode: LlmMode;
  provider: LlmProvider;
  apiProtocol: LlmApiProtocol;
  baseUrl: string | null;
  modelName: string;
  apiKey: string | null;
  apiVersion: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

interface LlmRoutingConfig {
  enabled: boolean;
  lowConfidenceThreshold: number;
  maxFallbackModels: number;
  minConfidenceGain: number;
  retryOnProviderFailure: boolean;
}

type LlmStrategyMode = 'quality' | 'balanced' | 'cost';

interface LlmAttemptTrace {
  model_id: string | null;
  model_name: string;
  provider: LlmProvider;
  mode: LlmMode;
  duration_ms: number;
  used_llm: boolean;
  confidence: number | null;
  retry_reason: 'primary' | 'provider_failure' | 'low_confidence';
  error: string | null;
}

interface OcrRuntimeConfig {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

const DEFAULT_MATCH_WEIGHTS: MatchWeightConfig = {
  must_have: 35,
  skills: 25,
  project: 20,
  experience: 15,
  education: 5
};

const DEFAULT_LLM_ROUTING: LlmRoutingConfig = {
  enabled: true,
  lowConfidenceThreshold: 0.62,
  maxFallbackModels: 1,
  minConfidenceGain: 0.04,
  retryOnProviderFailure: true
};

function normalizeLlmStrategyMode(value: unknown): LlmStrategyMode {
  if (value === 'quality' || value === 'balanced' || value === 'cost') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'quality' || v === 'balanced' || v === 'cost') return v;
  }
  return 'balanced';
}

function strategyPreset(mode: LlmStrategyMode): Omit<LlmRoutingConfig, 'enabled'> {
  if (mode === 'quality') {
    return {
      lowConfidenceThreshold: 0.72,
      maxFallbackModels: 1,
      minConfidenceGain: 0.02,
      retryOnProviderFailure: true
    };
  }
  if (mode === 'cost') {
    return {
      lowConfidenceThreshold: 0.5,
      maxFallbackModels: 1,
      minConfidenceGain: 0.12,
      retryOnProviderFailure: false
    };
  }
  return {
    lowConfidenceThreshold: DEFAULT_LLM_ROUTING.lowConfidenceThreshold,
    maxFallbackModels: DEFAULT_LLM_ROUTING.maxFallbackModels,
    minConfidenceGain: DEFAULT_LLM_ROUTING.minConfidenceGain,
    retryOnProviderFailure: DEFAULT_LLM_ROUTING.retryOnProviderFailure
  };
}

const KNOWN_SKILLS = [
  'Java',
  'Golang',
  'Go',
  'Python',
  'TypeScript',
  'JavaScript',
  'Spring Boot',
  'MySQL',
  'PostgreSQL',
  'Redis',
  'Kafka',
  'RabbitMQ',
  'Kubernetes',
  'Docker',
  'Microservices',
  'AWS',
  'Azure',
  'GCP',
  'React',
  'Node.js',
  'CI/CD',
  'GraphQL',
  'Elasticsearch',
  'ClickHouse',
  'Prometheus',
  'Linux',
  'SQL'
] as const;

const INFER_RULES: Array<{ skill: string; cues: string[]; reason: string }> = [
  {
    skill: '系统性能调优',
    cues: ['高并发', 'qps', '性能', '压测', 'latency', 'throughput'],
    reason: '项目描述包含高并发/性能优化语义'
  },
  {
    skill: '架构设计',
    cues: ['架构', '微服务', '服务拆分', '治理', 'design'],
    reason: '项目描述包含架构设计与治理语义'
  },
  {
    skill: '团队协作与推进',
    cues: ['跨团队', '协调', '推动', '协作', 'stakeholder'],
    reason: '项目描述体现跨团队协作行为'
  },
  {
    skill: '项目主导能力',
    cues: ['主导', '负责人', 'owner', 'lead'],
    reason: '项目描述出现主导/负责人证据'
  }
];

function normalizeLlmMode(value: unknown): LlmMode {
  if (value === 'local' || value === 'api_key' || value === 'bootstrap') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'local') return 'local';
    if (v === 'api_key' || v === 'api-key' || v === 'apikey') return 'api_key';
  }
  return 'bootstrap';
}

function normalizeLlmProvider(value: unknown): LlmProvider {
  if (
    value === 'custom' ||
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'google' ||
    value === 'deepseek' ||
    value === 'openrouter' ||
    value === 'ollama' ||
    value === 'vllm' ||
    value === 'zhipu' ||
    value === 'moonshot'
  ) {
    return value;
  }

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v in { custom: 1, openai: 1, anthropic: 1, google: 1, deepseek: 1, openrouter: 1, ollama: 1, vllm: 1, zhipu: 1, moonshot: 1 }) {
      return v as LlmProvider;
    }
  }

  return 'custom';
}

function protocolForProvider(provider: LlmProvider): LlmApiProtocol {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'google') return 'gemini';
  return 'openai';
}

function inferProtocol(provider: LlmProvider, baseUrl: string | null): LlmApiProtocol {
  const fromProvider = protocolForProvider(provider);
  if (provider !== 'custom') return fromProvider;

  const url = (baseUrl ?? '').toLowerCase();
  if (url.includes('anthropic')) return 'anthropic';
  if (url.includes('generativelanguage') || url.includes('gemini')) return 'gemini';
  return 'openai';
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(v)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(v)) return false;
  }
  return fallback;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value
      .map((x) => (typeof x === 'string' ? x : ''))
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractJsonPayload(raw: string): unknown {
  const direct = raw.trim();
  try {
    return JSON.parse(direct);
  } catch {
    const start = direct.indexOf('{');
    const end = direct.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(direct.slice(start, end + 1));
    }
    throw new Error('LLM 响应不包含有效 JSON');
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
  } catch {
    return '';
  }
}

function extractOpenAiMessageContent(message: Record<string, unknown> | null): string | null {
  const direct = cleanText(message?.content);
  if (direct) return direct;

  const contentParts = Array.isArray(message?.content) ? (message?.content as Array<Record<string, unknown>>) : [];
  const joined = contentParts
    .map((part) => cleanText(part.text))
    .filter((x): x is string => Boolean(x))
    .join('\n')
    .trim();

  return joined || null;
}

function describeAbortAsTimeout(controller: AbortController, timeoutMs: number, label: string, error: unknown): Error {
  if (controller.signal.aborted) {
    return new Error(`${label}请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查模型服务响应速度或调大 VITE_LLM_TIMEOUT_MS`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function screeningBackendBaseUrl(): string {
  const configured = cleanText(import.meta.env.VITE_FASTAPI_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  return '/api-fast';
}

function shouldUseBackendScreening(): boolean {
  const raw = cleanText(import.meta.env.VITE_SCREENING_USE_BACKEND);
  return raw != null && ['1', 'true', 'on', 'enabled'].includes(raw.toLowerCase());
}

async function readScreeningBackendError(response: Response): Promise<string> {
  const fallback = `后端识别失败: HTTP ${response.status}`;

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as Record<string, unknown>;
      const detail = cleanText(body.detail) ?? cleanText(body.message) ?? cleanText(body.error);
      return detail ?? fallback;
    }

    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text ? `${fallback}: ${text.slice(0, 220)}` : fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readCompletedBackendResult(resumeUploadId: string, positionId: string): Promise<Phase1PipelineResult | null> {
  const { data: upload, error: uploadError } = await supabase
    .from('resume_uploads')
    .select('id,status,pipeline_stage,error_code,error_message,candidate_id,parsed_payload')
    .eq('id', resumeUploadId)
    .single();

  if (uploadError) {
    throw new Error(`读取任务状态失败: ${uploadError.message}`);
  }

  const status = cleanText(upload?.status);
  const stage = cleanText(upload?.pipeline_stage);
  if (status === 'failed' || stage === 'failed') {
    const message = cleanText(upload?.error_message) ?? cleanText(upload?.error_code) ?? '识别失败';
    throw new Error(message);
  }
  if (status !== 'completed') return null;

  const candidateId = cleanText(upload?.candidate_id);
  if (!candidateId) return null;

  const { data: matchRows, error: matchError } = await supabase
    .from('candidate_position_matches')
    .select('id,overall_score,recommendation')
    .eq('resume_upload_id', resumeUploadId)
    .eq('position_id', positionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (matchError) {
    throw new Error(`读取匹配结果失败: ${matchError.message}`);
  }

  const match = matchRows?.[0] as Record<string, unknown> | undefined;
  const matchId = cleanText(match?.id);
  const overallScore = toFiniteNumber(match?.overall_score ?? toObject(upload?.parsed_payload)?.overall_score, Number.NaN);
  const recommendation = cleanText(match?.recommendation ?? toObject(upload?.parsed_payload)?.recommendation) as Recommendation | null;
  if (!matchId || !Number.isFinite(overallScore) || !recommendation) return null;

  const { data: profileRows, error: profileError } = await supabase
    .from('parsed_resume_profiles')
    .select('id')
    .eq('resume_upload_id', resumeUploadId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (profileError) {
    throw new Error(`读取画像结果失败: ${profileError.message}`);
  }

  const profileId = cleanText((profileRows?.[0] as Record<string, unknown> | undefined)?.id);
  if (!profileId) return null;

  return {
    candidateId,
    resumeUploadId,
    profileId,
    matchId,
    overallScore,
    recommendation
  };
}

async function runPhase1ResumePipelineOnBackend(
  file: File,
  position: ActivePositionRow,
  onStageChange?: (stage: PipelineProgressStage, message: string) => void,
  options?: Phase1PipelineRunOptions
): Promise<Phase1PipelineResult> {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('登录状态已失效，请重新登录后再识别简历');
  }

  const formData = new FormData();
  formData.append('position_json', JSON.stringify(position));
  formData.append('file', file, file.name);

  const controller = new AbortController();

  onStageChange?.('uploaded', '文件已提交后端，正在创建后台任务');

  try {
    const response = await fetch(`${screeningBackendBaseUrl()}/api/screening/phase1/async`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`
      },
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await readScreeningBackendError(response));
    }

    const submitted = toObject(await response.json());
    const resumeUploadId = cleanText(submitted?.resumeUploadId);
    if (!resumeUploadId) {
      throw new Error('后端任务响应缺少任务 ID');
    }

    onStageChange?.('text_extraction', '后台任务已创建，正在解析和分析');
    const startedAt = Date.now();
    let cancelRequested = false;
    while (Date.now() - startedAt < 20 * 60 * 1000) {
      if (options?.shouldCancel?.()) {
        if (!cancelRequested) {
          cancelRequested = true;
          await fetch(`${screeningBackendBaseUrl()}/api/uploads/${resumeUploadId}/cancel`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: '已取消识别', error_code: 'USER_CANCELLED' })
          }).catch(() => undefined);
        }
        throw new PipelineCancelledError('已取消识别');
      }

      const result = await readCompletedBackendResult(resumeUploadId, position.id);
      if (result) {
        onStageChange?.('completed', '匹配分析已完成');
        return result;
      }
      onStageChange?.('matching', '后台 AI 分析中，可继续等待任务完成');
      await sleep(2000);
    }

    throw new Error('后台识别超时，请稍后刷新任务列表查看结果');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new PipelineCancelledError('已取消识别');
    }
    throw error;
  }
}

function openAIChatUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function buildRuntimeConfigFromModelRow(
  modelRow: Record<string, unknown>,
  envOverrides?: {
    apiVersion?: string | null;
    maxTokens?: number | null;
    temperature?: number | null;
    timeoutMs?: number | null;
    apiKey?: string | null;
  }
): LlmRuntimeConfig | null {
  const isActive = modelRow.is_active === true;
  const modelName = cleanText(modelRow.model_name);
  if (!isActive || !modelName) return null;

  const provider = normalizeLlmProvider(modelRow.provider);
  const baseUrl = cleanText(modelRow.base_url);
  const mode = normalizeLlmMode(modelRow.mode);
  const apiVersion = cleanText(envOverrides?.apiVersion) ?? cleanText(modelRow.api_version) ?? '2023-06-01';
  const maxTokens = Math.max(
    128,
    Math.min(8192, Math.round(toFiniteNumber(envOverrides?.maxTokens ?? modelRow.max_tokens, 2048)))
  );
  const temperature = Math.max(0, Math.min(2, toFiniteNumber(envOverrides?.temperature ?? modelRow.temperature, 0.2)));
  const timeoutMs = Math.max(
    5000,
    Math.min(180000, Math.round(toFiniteNumber(envOverrides?.timeoutMs ?? modelRow.timeout_ms, 120000)))
  );
  const apiKey = cleanText(envOverrides?.apiKey) ?? cleanText(modelRow.api_key_encrypted);

  return {
    modelId: cleanText(modelRow.id),
    mode,
    provider,
    apiProtocol: inferProtocol(provider, baseUrl),
    baseUrl,
    modelName,
    apiKey,
    apiVersion,
    maxTokens,
    temperature,
    timeoutMs
  };
}

async function loadLlmRoutingConfig(): Promise<LlmRoutingConfig> {
  const envEnabledRaw = cleanText(import.meta.env.VITE_LLM_ROUTING_ENABLED);
  const envLowConfidenceRaw = cleanText(import.meta.env.VITE_LLM_LOW_CONFIDENCE_THRESHOLD);
  const envMaxFallbackRaw = cleanText(import.meta.env.VITE_LLM_MAX_FALLBACK_MODELS);
  const envMinGainRaw = cleanText(import.meta.env.VITE_LLM_MIN_CONFIDENCE_GAIN);
  const envRetryOnFailureRaw = cleanText(import.meta.env.VITE_LLM_RETRY_ON_PROVIDER_FAILURE);
  const envStrategyRaw = cleanText(import.meta.env.VITE_LLM_STRATEGY_MODE);

  let retryEnabled = true;
  let strategyMode: LlmStrategyMode = 'balanced';

  try {
    const { data } = await supabase.from('company_settings').select('*').single();
    const row = (data ?? null) as Record<string, unknown> | null;
    retryEnabled = toBoolean(row?.llm_retry_enabled, true);
    strategyMode = normalizeLlmStrategyMode(row?.llm_strategy_mode);
  } catch {
    retryEnabled = true;
    strategyMode = 'balanced';
  }

  if (envStrategyRaw) {
    strategyMode = normalizeLlmStrategyMode(envStrategyRaw);
  }

  const preset = strategyPreset(strategyMode);
  const base: LlmRoutingConfig = {
    enabled: retryEnabled,
    lowConfidenceThreshold: preset.lowConfidenceThreshold,
    maxFallbackModels: preset.maxFallbackModels,
    minConfidenceGain: preset.minConfidenceGain,
    retryOnProviderFailure: preset.retryOnProviderFailure
  };

  const enabled = envEnabledRaw != null ? toBoolean(envEnabledRaw, base.enabled) : base.enabled;
  const lowConfidenceThreshold =
    envLowConfidenceRaw != null
      ? Math.max(0.3, Math.min(0.95, toFiniteNumber(envLowConfidenceRaw, base.lowConfidenceThreshold)))
      : base.lowConfidenceThreshold;
  const maxFallbackModels =
    envMaxFallbackRaw != null
      ? Math.max(0, Math.min(3, Math.round(toFiniteNumber(envMaxFallbackRaw, base.maxFallbackModels))))
      : base.maxFallbackModels;
  const minConfidenceGain =
    envMinGainRaw != null
      ? Math.max(0, Math.min(0.3, toFiniteNumber(envMinGainRaw, base.minConfidenceGain)))
      : base.minConfidenceGain;
  const retryOnProviderFailure =
    envRetryOnFailureRaw != null ? toBoolean(envRetryOnFailureRaw, base.retryOnProviderFailure) : base.retryOnProviderFailure;

  return {
    enabled,
    lowConfidenceThreshold,
    maxFallbackModels,
    minConfidenceGain,
    retryOnProviderFailure
  };
}

async function loadLlmRuntimeConfig(): Promise<LlmRuntimeConfig> {
  const envMode = normalizeLlmMode(import.meta.env.VITE_LLM_MODE);
  const envProvider = normalizeLlmProvider(import.meta.env.VITE_LLM_PROVIDER);
  const envBaseUrl = cleanText(import.meta.env.VITE_LLM_BASE_URL);
  const envModelName = cleanText(import.meta.env.VITE_LLM_MODEL);
  const envApiKey = cleanText(import.meta.env.VITE_LLM_API_KEY);
  const envApiVersion = cleanText(import.meta.env.VITE_LLM_API_VERSION);
  const envMaxTokens = Math.max(128, Math.min(8192, Math.round(toFiniteNumber(import.meta.env.VITE_LLM_MAX_TOKENS, 2048))));
  const envTemperature = toFiniteNumber(import.meta.env.VITE_LLM_TEMPERATURE, 0.2);
  const envTimeoutMs = Math.max(5000, Math.min(180000, Math.round(toFiniteNumber(import.meta.env.VITE_LLM_TIMEOUT_MS, 120000))));

  // Dev override: allow env-only model config to bypass DB registry
  if (envMode !== 'bootstrap' && envModelName && envBaseUrl) {
    const provider = envProvider;
    return {
      modelId: null,
      mode: envMode,
      provider,
      apiProtocol: inferProtocol(provider, envBaseUrl),
      baseUrl: envBaseUrl,
      modelName: envModelName,
      apiKey: envApiKey,
      apiVersion: envApiVersion ?? '2023-06-01',
      maxTokens: envMaxTokens,
      temperature: envTemperature,
      timeoutMs: envTimeoutMs
    };
  }

  const { data: settingsData } = await supabase.from('company_settings').select('active_llm_model_id').single();
  const activeModelId = cleanText((settingsData as Record<string, unknown> | null)?.active_llm_model_id);

  if (!activeModelId) {
    return {
      modelId: null,
      mode: 'bootstrap',
      provider: 'custom',
      apiProtocol: 'openai',
      baseUrl: null,
      modelName: 'rule-based-bootstrap',
      apiKey: null,
      apiVersion: '2023-06-01',
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 120000
    };
  }

  const { data: modelRowData } = await supabase
    .from('llm_model_configs')
    .select('id, provider, mode, model_name, base_url, api_key_encrypted, api_version, max_tokens, temperature, timeout_ms, is_active')
    .eq('id', activeModelId)
    .single();

  const modelRow = (modelRowData ?? null) as Record<string, unknown> | null;
  if (!modelRow) {
    return {
      modelId: null,
      mode: 'bootstrap',
      provider: 'custom',
      apiProtocol: 'openai',
      baseUrl: null,
      modelName: 'rule-based-bootstrap',
      apiKey: null,
      apiVersion: '2023-06-01',
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 120000
    };
  }

  const resolved = buildRuntimeConfigFromModelRow(modelRow, {
    apiVersion: envApiVersion,
    maxTokens: envMaxTokens !== 2048 ? envMaxTokens : null,
    temperature: envTemperature !== 0.2 ? envTemperature : null,
    timeoutMs: envTimeoutMs !== 120000 ? envTimeoutMs : null,
    apiKey: envApiKey
  });

  if (!resolved) {
    return {
      modelId: null,
      mode: 'bootstrap',
      provider: 'custom',
      apiProtocol: 'openai',
      baseUrl: null,
      modelName: 'rule-based-bootstrap',
      apiKey: null,
      apiVersion: '2023-06-01',
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 120000
    };
  }

  return resolved;
}

async function loadFallbackLlmRuntimeConfigs(primary: LlmRuntimeConfig, maxCount: number): Promise<LlmRuntimeConfig[]> {
  if (primary.mode === 'bootstrap' || maxCount <= 0) return [];

  try {
    const { data, error } = await supabase
      .from('llm_model_configs')
      .select('id, provider, mode, model_name, base_url, api_key_encrypted, api_version, max_tokens, temperature, timeout_ms, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return [];

    const fallback = (data as Array<Record<string, unknown>>)
      .filter((row) => {
        const rowId = cleanText(row.id);
        if (primary.modelId && rowId === primary.modelId) return false;

        const rowModelName = cleanText(row.model_name);
        const rowProvider = normalizeLlmProvider(row.provider);
        const rowBaseUrl = cleanText(row.base_url) ?? '';
        const primaryBaseUrl = primary.baseUrl ?? '';
        if (!primary.modelId && rowModelName === primary.modelName && rowProvider === primary.provider && rowBaseUrl === primaryBaseUrl) {
          return false;
        }
        return true;
      })
      .map((row) => buildRuntimeConfigFromModelRow(row))
      .filter((row): row is LlmRuntimeConfig => Boolean(row))
      .filter((row) => row.mode !== 'bootstrap')
      .slice(0, maxCount);

    return fallback;
  } catch {
    return [];
  }
}

async function loadOcrRuntimeConfig(): Promise<OcrRuntimeConfig> {
  const envEnabled = toBoolean(import.meta.env.VITE_OCR_ENABLED, false);
  const envBaseUrl = cleanText(import.meta.env.VITE_OCR_BASE_URL);
  const envApiKey = cleanText(import.meta.env.VITE_OCR_API_KEY);
  const envTimeoutMs = Math.max(5000, Math.min(180000, Math.round(toFiniteNumber(import.meta.env.VITE_OCR_TIMEOUT_MS, 45000))));

  if (envEnabled && envBaseUrl) {
    return {
      enabled: true,
      baseUrl: envBaseUrl,
      apiKey: envApiKey,
      timeoutMs: envTimeoutMs
    };
  }

  const { data } = await supabase
    .from('company_settings')
    .select('ocr_enabled, ocr_base_url, ocr_api_key, ocr_timeout_ms')
    .single();

  const row = (data ?? null) as Record<string, unknown> | null;
  const enabled = toBoolean(row?.ocr_enabled, false);
  const baseUrl = cleanText(row?.ocr_base_url);
  const apiKey = envApiKey ?? cleanText(row?.ocr_api_key);
  const timeoutMs = Math.max(5000, Math.min(180000, Math.round(toFiniteNumber(row?.ocr_timeout_ms, 45000))));

  return {
    enabled: enabled && Boolean(baseUrl),
    baseUrl,
    apiKey,
    timeoutMs: envTimeoutMs !== 45000 ? envTimeoutMs : timeoutMs
  };
}

function normalizeMatchWeights(input: Partial<MatchWeightConfig> | null | undefined): MatchWeightConfig {
  const raw = {
    must_have: Math.max(0, toFiniteNumber(input?.must_have, DEFAULT_MATCH_WEIGHTS.must_have)),
    skills: Math.max(0, toFiniteNumber(input?.skills, DEFAULT_MATCH_WEIGHTS.skills)),
    project: Math.max(0, toFiniteNumber(input?.project, DEFAULT_MATCH_WEIGHTS.project)),
    experience: Math.max(0, toFiniteNumber(input?.experience, DEFAULT_MATCH_WEIGHTS.experience)),
    education: Math.max(0, toFiniteNumber(input?.education, DEFAULT_MATCH_WEIGHTS.education))
  };

  const sum = raw.must_have + raw.skills + raw.project + raw.experience + raw.education;
  if (sum <= 0) return DEFAULT_MATCH_WEIGHTS;

  // Keep percentages (sum ~ 100) for transparency in stored configs; normalize only when applying formula.
  return raw;
}

async function loadMatchWeightConfig(): Promise<MatchWeightConfig> {
  const envMust = toFiniteNumber(import.meta.env.VITE_MATCH_WEIGHT_MUST_HAVE, DEFAULT_MATCH_WEIGHTS.must_have);
  const envSkills = toFiniteNumber(import.meta.env.VITE_MATCH_WEIGHT_SKILLS, DEFAULT_MATCH_WEIGHTS.skills);
  const envProject = toFiniteNumber(import.meta.env.VITE_MATCH_WEIGHT_PROJECT, DEFAULT_MATCH_WEIGHTS.project);
  const envExp = toFiniteNumber(import.meta.env.VITE_MATCH_WEIGHT_EXPERIENCE, DEFAULT_MATCH_WEIGHTS.experience);
  const envEdu = toFiniteNumber(import.meta.env.VITE_MATCH_WEIGHT_EDUCATION, DEFAULT_MATCH_WEIGHTS.education);
  const envSum = envMust + envSkills + envProject + envExp + envEdu;

  if (envSum > 0) {
    return normalizeMatchWeights({
      must_have: envMust,
      skills: envSkills,
      project: envProject,
      experience: envExp,
      education: envEdu
    });
  }

  try {
    const { data, error } = await supabase
      .from('company_settings')
      .select(
        'match_weight_must_have, match_weight_skills, match_weight_project, match_weight_experience, match_weight_education'
      )
      .single();

    if (error || !data) {
      return DEFAULT_MATCH_WEIGHTS;
    }

    const row = data as Record<string, unknown>;
    return normalizeMatchWeights({
      must_have: toFiniteNumber(row.match_weight_must_have, DEFAULT_MATCH_WEIGHTS.must_have),
      skills: toFiniteNumber(row.match_weight_skills, DEFAULT_MATCH_WEIGHTS.skills),
      project: toFiniteNumber(row.match_weight_project, DEFAULT_MATCH_WEIGHTS.project),
      experience: toFiniteNumber(row.match_weight_experience, DEFAULT_MATCH_WEIGHTS.experience),
      education: toFiniteNumber(row.match_weight_education, DEFAULT_MATCH_WEIGHTS.education)
    });
  } catch {
    return DEFAULT_MATCH_WEIGHTS;
  }
}

function anthropicMessagesUrl(baseUrl: string | null): string {
  if (!baseUrl) return 'https://api.anthropic.com/v1/messages';
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function geminiGenerateUrl(baseUrl: string | null, modelName: string, apiKey: string | null): string {
  const base = baseUrl
    ? baseUrl.endsWith('/')
      ? baseUrl.slice(0, -1)
      : baseUrl
    : 'https://generativelanguage.googleapis.com/v1beta';

  let url = base;
  if (!url.includes(':generateContent')) {
    if (url.endsWith('/v1beta') || url.endsWith('/v1')) {
      url = `${url}/models/${modelName}:generateContent`;
    } else if (url.includes('/models/')) {
      url = `${url}:generateContent`;
    } else {
      url = `${url}/v1beta/models/${modelName}:generateContent`;
    }
  }

  if (apiKey && !url.includes('key=')) {
    url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  }

  return url;
}

function extractAnthropicText(raw: Record<string, unknown>): string {
  const content = Array.isArray(raw.content) ? (raw.content as Array<Record<string, unknown>>) : [];
  const text = content
    .map((part) => cleanText(part.text))
    .filter((x): x is string => Boolean(x))
    .join('\n')
    .trim();
  return text;
}

function extractGeminiText(raw: Record<string, unknown>): string {
  const candidates = Array.isArray(raw.candidates) ? (raw.candidates as Array<Record<string, unknown>>) : [];
  const first = candidates[0] ?? null;
  const content = toObject(first?.content);
  const parts = Array.isArray(content?.parts) ? (content?.parts as Array<Record<string, unknown>>) : [];
  const text = parts
    .map((p) => cleanText(p.text))
    .filter((x): x is string => Boolean(x))
    .join('\n')
    .trim();
  return text;
}

async function callOpenAIProtocolJson(
  config: LlmRuntimeConfig,
  systemPrompt: string,
  userPayload: Record<string, unknown>
): Promise<{ json: unknown; raw: unknown }> {
  if (!config.baseUrl) {
    throw new Error('LLM base URL 未配置');
  }

  const url = openAIChatUrl(config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const makeBody = (includeResponseFormat: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: config.modelName,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) }
        ]
      };

      if (includeResponseFormat) {
        body.response_format = { type: 'json_object' };
      }

      return body;
    };

    const shouldTryJsonMode = config.mode === 'api_key';
    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(makeBody(shouldTryJsonMode)),
      signal: controller.signal
    });

    // Some OpenAI-compatible providers reject response_format, retry once without it.
    if (!response.ok && shouldTryJsonMode && [400, 404, 415, 422].includes(response.status)) {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(makeBody(false)),
        signal: controller.signal
      });
    }

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new Error(`LLM HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(raw.choices) ? (raw.choices as Array<Record<string, unknown>>) : [];
    const first = choices[0] ?? null;
    const message = toObject(first?.message);
    const content = extractOpenAiMessageContent(message);

    if (!content) {
      throw new Error('LLM 响应内容为空');
    }

    const json = extractJsonPayload(content);
    return { json, raw };
  } catch (error) {
    throw describeAbortAsTimeout(controller, config.timeoutMs, 'LLM', error);
  } finally {
    clearTimeout(timeout);
  }
}

async function callAnthropicProtocolJson(
  config: LlmRuntimeConfig,
  systemPrompt: string,
  userPayload: Record<string, unknown>
): Promise<{ json: unknown; raw: unknown }> {
  if (!config.apiKey) {
    throw new Error('Anthropic 协议需要 API key');
  }

  const url = anthropicMessagesUrl(config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': config.apiVersion || '2023-06-01'
      },
      body: JSON.stringify({
        model: config.modelName,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const content = extractAnthropicText(raw);
    if (!content) {
      throw new Error('Anthropic 响应内容为空');
    }
    const json = extractJsonPayload(content);
    return { json, raw };
  } catch (error) {
    throw describeAbortAsTimeout(controller, config.timeoutMs, 'LLM', error);
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiProtocolJson(
  config: LlmRuntimeConfig,
  systemPrompt: string,
  userPayload: Record<string, unknown>
): Promise<{ json: unknown; raw: unknown }> {
  const url = geminiGenerateUrl(config.baseUrl, config.modelName, config.apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${JSON.stringify(userPayload)}` }]
          }
        ],
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const content = extractGeminiText(raw);
    if (!content) {
      throw new Error('Gemini 响应内容为空');
    }
    const json = extractJsonPayload(content);
    return { json, raw };
  } catch (error) {
    throw describeAbortAsTimeout(controller, config.timeoutMs, 'LLM', error);
  } finally {
    clearTimeout(timeout);
  }
}

async function callUniversalLlmJson(
  config: LlmRuntimeConfig,
  systemPrompt: string,
  userPayload: Record<string, unknown>
): Promise<{ json: unknown; raw: unknown }> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (config.apiProtocol === 'anthropic') {
        return await callAnthropicProtocolJson(config, systemPrompt, userPayload);
      }
      if (config.apiProtocol === 'gemini') {
        return await callGeminiProtocolJson(config, systemPrompt, userPayload);
      }
      return await callOpenAIProtocolJson(config, systemPrompt, userPayload);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      const status = Number((message.match(/LLM HTTP (\d{3})/i)?.[1] ?? NaN));
      const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(status);
      const retryableNetwork =
        lower.includes('abort') ||
        lower.includes('timeout') ||
        lower.includes('timed out') ||
        lower.includes('failed to fetch') ||
        lower.includes('network');
      const shouldRetry = attempt < maxAttempts && (retryableStatus || retryableNetwork);
      if (!shouldRetry) break;

      await new Promise((resolve) => setTimeout(resolve, 220 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM 调用失败');
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function toSafeName(name: string): string {
  return name
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '')
    .slice(0, 80);
}

function normalizeSkill(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'go') return 'Golang';
  if (lower === 'js') return 'JavaScript';
  if (lower === 'ts') return 'TypeScript';
  if (lower === 'node') return 'Node.js';

  const found = KNOWN_SKILLS.find((s) => s.toLowerCase() === lower);
  return found ?? trimmed;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function containsCjk(text: string | null | undefined): boolean {
  if (!text) return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

function detectSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const detected = KNOWN_SKILLS.filter((skill) => lower.includes(skill.toLowerCase())).map((s) => normalizeSkill(s));
  return uniqueStrings(detected);
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n。！？!?;.]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 8);
}

function buildEvidenceSpans(text: string): EvidenceSpan[] {
  const sentences = splitSentences(text).slice(0, 20);
  let cursor = 0;

  return sentences.map((sentence, idx) => {
    const start = Math.max(text.indexOf(sentence, cursor), 0);
    const end = start + sentence.length;
    cursor = end;
    return {
      span_id: `sp_${idx + 1}`,
      page_no: null,
      char_start: start,
      char_end: end,
      text_excerpt: sentence.slice(0, 260)
    };
  });
}

function scoreToRecommendation(score: number): Recommendation {
  if (score >= 85) return 'strong_match';
  if (score >= 70) return 'partial_match';
  if (score >= 55) return 'weak_match';
  return 'reject';
}

function recommendationToTag(rec: Recommendation): string {
  if (rec === 'strong_match') return '精准匹配';
  if (rec === 'partial_match') return '建议复核';
  if (rec === 'weak_match') return '潜力待定';
  return '不推荐';
}

function educationRank(level: string | null | undefined): number {
  if (!level) return 0;
  if (level.includes('博士')) return 4;
  if (level.includes('硕士')) return 3;
  if (level.includes('本科')) return 2;
  if (level.includes('大专')) return 1;
  return 0;
}

function inferLeadershipLevel(sentence: string): ParsedProject['leadership_level'] {
  const lower = sentence.toLowerCase();
  if (/(主导|负责人|owner|lead)/i.test(lower)) return 'lead';
  if (/(独立|end-to-end|独当一面)/i.test(lower)) return 'independent';
  if (/(负责|参与|实现|使用|搭建)/i.test(lower)) return 'used';
  if (/(了解|熟悉)/i.test(lower)) return 'aware';
  return 'unknown';
}

function inferComplexity(sentence: string): ParsedProject['complexity_level'] {
  const lower = sentence.toLowerCase();
  if (/(千万|亿级|高并发|低延迟|分布式|多集群|global)/i.test(lower)) return 'high';
  if (/(中台|服务化|微服务|稳定性)/i.test(lower)) return 'medium';
  if (/(维护|迭代|优化)/i.test(lower)) return 'low';
  return 'unknown';
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extractHumanReadableText(raw: string): string {
  const candidates = raw.match(/[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9，。！？；：、,.!?;:()\-_/ ]{8,}/g) ?? [];

  const filtered = candidates
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length >= 10)
    .filter((x) => !/\/(type|catalog|pages|font|filter|flatedecode|xref|obj|endobj|stream)/i.test(x));

  return uniqueStrings(filtered).join(' ').slice(0, 20000);
}

function looksLikeContainerNoise(text: string, extension: string): boolean {
  if (!text) return true;

  const sample = text.slice(0, 10000);
  const markerCount = (sample.match(/\/(Type|Catalog|Pages|Font|Filter|FlateDecode|XObject|MediaBox)\b/g) ?? []).length;
  const streamCount = (sample.match(/\b(stream|endstream|obj|endobj|xref)\b/gi) ?? []).length;
  const symbolDensity = ((sample.match(/[<>/\\[\]{}]/g) ?? []).length / Math.max(1, sample.length));
  const naturalDensity = ((sample.match(/[\u4e00-\u9fa5A-Za-z0-9，。！？；：,.!?;:() \n\r\t-]/g) ?? []).length / Math.max(1, sample.length));

  if (extension === 'pdf') {
    if (markerCount >= 3 || streamCount >= 5) return true;
    if (symbolDensity > 0.08 && naturalDensity < 0.9) return true;
  }

  return false;
}

function normalizeNaturalText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPdfTextWithPdfJs(file: File): Promise<string | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await file.arrayBuffer());
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    }

    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items as Array<Record<string, unknown>>)
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join(' ');

      if (pageText.trim().length > 0) {
        pages.push(pageText);
      }
    }

    const merged = normalizeNaturalText(pages.join('\n'));
    return merged.length > 0 ? merged : null;
  } catch {
    return null;
  }
}

async function extractDocxTextWithMammoth(file: File): Promise<string | null> {
  try {
    const mammothModule = await import('mammoth');
    const mammoth = (mammothModule as unknown as { default?: { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }; extractRawText?: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }).default
      ? (mammothModule as unknown as { default: { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> } }).default
      : (mammothModule as unknown as { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> });

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = normalizeNaturalText(result.value ?? '');
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function extractTextFromOcrPayload(raw: unknown): string | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const direct = cleanText(obj.text) ?? cleanText(obj.content) ?? cleanText(obj.result);
  if (direct) return direct;

  const nestedResult = toObject(obj.result);
  const nestedText = cleanText(nestedResult?.text) ?? cleanText(nestedResult?.content);
  if (nestedText) return nestedText;

  const dataObj = toObject(obj.data);
  const dataText = cleanText(dataObj?.text) ?? cleanText(dataObj?.content);
  if (dataText) return dataText;

  return null;
}

async function callOcrService(file: File, config: OcrRuntimeConfig): Promise<string | null> {
  if (!config.enabled || !config.baseUrl) return null;

  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
        headers['x-api-key'] = config.apiKey;
      }

      const response = await fetch(config.baseUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await readErrorBody(response);
        const message = `OCR HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
        const retryable = attempt < maxAttempts && [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        if (retryable) {
          await new Promise((resolve) => setTimeout(resolve, 280 * attempt));
          continue;
        }
        throw new Error(message);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = await response.json();
        const text = extractTextFromOcrPayload(json);
        if (text) return text;
        throw new Error('OCR 响应缺少 text 字段');
      }

      const text = (await response.text()).trim();
      if (text.length > 0) return text;
      throw new Error('OCR 响应内容为空');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      const retryable = attempt < maxAttempts && (lower.includes('timeout') || lower.includes('abort') || lower.includes('network'));
      if (!retryable) {
        throw error instanceof Error ? error : new Error(message);
      }
      lastError = error instanceof Error ? error : new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 280 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function extractLooseText(
  file: File,
  ocrConfig?: OcrRuntimeConfig
): Promise<{ text: string; quality: 'good' | 'poor'; source: 'local_parser' | 'text_layer' | 'ocr' | 'fallback' }> {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';

  if (extension === 'pdf') {
    const pdfText = await extractPdfTextWithPdfJs(file);
    if (pdfText && pdfText.length >= 120) {
      return {
        text: pdfText.slice(0, 20000),
        quality: pdfText.length >= 300 ? 'good' : 'poor',
        source: 'local_parser'
      };
    }
  }

  if (extension === 'docx') {
    const docxText = await extractDocxTextWithMammoth(file);
    if (docxText && docxText.length >= 120) {
      return {
        text: docxText.slice(0, 20000),
        quality: docxText.length >= 300 ? 'good' : 'poor',
        source: 'local_parser'
      };
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const decoded = decoder.decode(bytes);
  const cleaned = normalizeNaturalText(decoded);
  const readable = extractHumanReadableText(cleaned);
  const preferred = readable.length >= 300 ? readable : cleaned;
  const sourceNoisy = looksLikeContainerNoise(cleaned, extension);

  if (!sourceNoisy && preferred.length >= 300 && !looksLikeContainerNoise(preferred, extension)) {
    return { text: preferred.slice(0, 20000), quality: 'good', source: 'text_layer' };
  }

  if (ocrConfig?.enabled && ocrConfig.baseUrl) {
    try {
      const ocrTextRaw = await callOcrService(file, ocrConfig);
      const ocrText = cleanText(ocrTextRaw)?.replace(/\s+/g, ' ').trim() ?? '';
      if (ocrText.length >= 120) {
        return {
          text: ocrText.slice(0, 20000),
          quality: ocrText.length >= 300 ? 'good' : 'poor',
          source: 'ocr'
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown';
      const fallback = `文件名: ${file.name}; 文件类型: ${extension}; OCR调用失败：${msg}`;
      return { text: fallback.slice(0, 20000), quality: 'poor', source: 'fallback' };
    }
  }

  if (readable.length >= 120) {
    return { text: readable.slice(0, 20000), quality: 'poor', source: 'text_layer' };
  }

  const fallback = `文件名: ${file.name}; 文件类型: ${extension}; 文本层质量较差，建议启用 OCR 或专业解析器。`;
  return { text: fallback, quality: 'poor', source: 'fallback' };
}

function parseBasicProfile(text: string, fileName: string): BasicProfile {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/)?.[1] ?? null;
  const years = text.match(/(\d{1,2})\s*年(?:工作|经验|开发|研发)?/)?.[1];
  const titleMatch = text.match(/(架构师|工程师|开发|技术负责人|Tech Lead|Engineering Manager|研发经理)/i)?.[0] ?? null;

  const strippedName = fileName
    .replace(/\.(pdf|doc|docx)$/i, '')
    .replace(/[_\-.]/g, ' ')
    .trim();

  return {
    full_name: strippedName || null,
    email,
    phone,
    current_title: titleMatch,
    years_of_experience: years ? parseInt(years, 10) : null
  };
}

function parseEducation(text: string): Array<Record<string, unknown>> {
  const level = text.match(/博士|硕士|本科|大专/)?.[0] ?? null;
  if (!level) return [];

  return [
    {
      degree: level,
      institution: text.match(/([\u4e00-\u9fa5A-Za-z]+大学)/)?.[0] ?? null,
      confidence: 0.74
    }
  ];
}

function parseCertifications(text: string): Array<Record<string, unknown>> {
  const certs = ['PMP', 'AWS', 'Azure', 'CFA', '软考', 'TOGAF'].filter((c) => text.toLowerCase().includes(c.toLowerCase()));
  return certs.map((name) => ({ name, confidence: 0.72 }));
}

function parseProjects(text: string, spans: EvidenceSpan[]): ParsedProject[] {
  const sentences = splitSentences(text);
  const candidateSentences = sentences.filter((s) => /(项目|系统|平台|负责|主导|开发|上线|优化|重构|架构)/i.test(s));
  const selected = (candidateSentences.length > 0 ? candidateSentences : sentences).slice(0, 3);

  return selected.map((sentence, idx) => {
    const span = spans[idx];
    const skills = detectSkills(sentence);

    return {
      project_name: `项目经历 ${idx + 1}`,
      project_summary: sentence.slice(0, 300),
      candidate_role: /(架构师|Tech Lead|负责人|工程师)/i.test(sentence) ? sentence.match(/(架构师|Tech Lead|负责人|工程师)/i)?.[0] ?? null : null,
      responsibilities: uniqueStrings(
        sentence
          .split(/[，,、]/)
          .map((p) => p.trim())
          .filter((p) => p.length >= 4)
      ).slice(0, 5),
      tech_stack: skills,
      domain: /(金融|支付|电商|医疗|教育|AI|广告|SaaS)/i.test(sentence) ? sentence.match(/(金融|支付|电商|医疗|教育|AI|广告|SaaS)/i)?.[0] ?? null : null,
      complexity_level: inferComplexity(sentence),
      leadership_level: inferLeadershipLevel(sentence),
      evidence_spans: span ? [span.span_id] : [],
      confidence: sentence.length > 30 ? 0.8 : 0.62
    };
  });
}

function inferSkills(text: string, spans: EvidenceSpan[]): InferredSkillItem[] {
  const lower = text.toLowerCase();
  return INFER_RULES.filter((rule) => rule.cues.some((cue) => lower.includes(cue.toLowerCase()))).map((rule, idx) => ({
    skill: rule.skill,
    inference_reason: rule.reason,
    confidence: 0.68,
    evidence_span_ids: spans[idx] ? [spans[idx].span_id] : []
  }));
}

function parseWorkExperience(text: string): Array<Record<string, unknown>> {
  const years = [...text.matchAll(/(20\d{2})[./-]?(0?[1-9]|1[0-2])?\s*(?:-|至|到|~|—)\s*(20\d{2}|至今|present)/gi)].slice(0, 4);
  return years.map((m) => ({
    period: m[0],
    start_year: m[1],
    end_year: m[3],
    confidence: 0.61
  }));
}

function buildRiskFlags(profile: ResumeProfilePayload, textQuality: 'good' | 'poor'): Array<Record<string, unknown>> {
  const riskFlags: Array<Record<string, unknown>> = [];

  if (textQuality === 'poor') {
    riskFlags.push({
      type: 'low_text_coverage',
      severity: 'high',
      message: '文本层不足，建议启用 OCR 或专业解析器'
    });
  }

  if (profile.explicit_skills.length === 0) {
    riskFlags.push({
      type: 'skill_evidence_weak',
      severity: 'medium',
      message: '未识别到显式技能，建议补充更完整简历后重试'
    });
  }

  if (!profile.basic_profile.email && !profile.basic_profile.phone) {
    riskFlags.push({
      type: 'contact_missing',
      severity: 'low',
      message: '联系方式未明确提取到'
    });
  }

  return riskFlags;
}

function buildJobRequirementFromPosition(position: ActivePositionRow): ParsedJobRequirement {
  const sourceText = [position.title, position.technical_requirements ?? ''].join(' ');
  const detectedSkills = detectSkills(sourceText);
  const mustHave = detectedSkills.slice(0, 6).map((skill) => ({
    skill,
    min_level: 'independent',
    min_years: null
  }));

  const clauses = (position.technical_requirements ?? '')
    .split(/[。；;\n]/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
    .slice(0, 6);

  return {
    position_title: position.title,
    must_have_skills: mustHave,
    nice_to_have_skills: [],
    required_experience_years: position.min_exp ?? null,
    education_requirement: {
      min_level: position.min_edu ?? null,
      is_strict: true
    },
    industry_preference: [],
    project_keywords: uniqueStrings(detectedSkills).slice(0, 8),
    seniority_level: (position.min_exp ?? 0) >= 8 ? 'staff_plus' : (position.min_exp ?? 0) >= 5 ? 'senior' : 'mid',
    core_responsibilities: clauses
  };
}

function buildResumeProfile(fileName: string, text: string, textQuality: 'good' | 'poor'): ResumeProfilePayload {
  const evidenceSpans = buildEvidenceSpans(text);
  const basicProfile = parseBasicProfile(text, fileName);
  const explicitSkillNames = detectSkills(text);

  const explicitSkills: SkillItem[] = explicitSkillNames.map((skill, idx) => ({
    skill,
    confidence: 0.82,
    evidence_span_ids: evidenceSpans[idx] ? [evidenceSpans[idx].span_id] : []
  }));

  const inferredSkills = inferSkills(text, evidenceSpans);
  const projects = parseProjects(text, evidenceSpans);
  const workExperience = parseWorkExperience(text);
  const education = parseEducation(text);
  const certifications = parseCertifications(text);

  const profile: ResumeProfilePayload = {
    basic_profile: basicProfile,
    explicit_skills: explicitSkills,
    inferred_skills: inferredSkills,
    projects,
    work_experience: workExperience,
    education,
    certifications,
    risk_flags: [],
    extraction_confidence: {
      overall: textQuality === 'good' ? 0.8 : 0.58,
      by_section: {
        projects: projects.length > 0 ? 0.82 : 0.45,
        skills: explicitSkills.length > 0 ? 0.8 : 0.42,
        education: education.length > 0 ? 0.9 : 0.5
      }
    },
    evidence_spans: evidenceSpans
  };

  profile.risk_flags = buildRiskFlags(profile, textQuality);
  return profile;
}

type ResumeEnhancementResult = {
  profile: ResumeProfilePayload;
  usedLlm: boolean;
  llmRaw: unknown | null;
  modelVersion: string;
};

type MatchEnhancementResult = {
  match: MatchOutput;
  usedLlm: boolean;
  llmRaw: unknown | null;
  modelVersion: string;
};

function extractLlmError(raw: unknown): string | null {
  const obj = toObject(raw);
  const direct = cleanText(obj?.error);
  if (direct) return direct;
  const payloadObj = toObject(obj?.payload);
  return cleanText(payloadObj?.error);
}

function shouldRetryByReason(
  usedLlm: boolean,
  confidence: number | null,
  routing: LlmRoutingConfig
): 'provider_failure' | 'low_confidence' | null {
  if (!routing.enabled) return null;
  if (routing.retryOnProviderFailure && !usedLlm) return 'provider_failure';
  if (confidence != null && confidence < routing.lowConfidenceThreshold) return 'low_confidence';
  return null;
}

async function maybeEnhanceResumeProfileWithLlm(
  config: LlmRuntimeConfig,
  fileName: string,
  text: string,
  baseProfile: ResumeProfilePayload
): Promise<ResumeEnhancementResult> {
  if (config.mode === 'bootstrap') {
    return { profile: baseProfile, usedLlm: false, llmRaw: null, modelVersion: 'rule-based-bootstrap' };
  }

  const spans = baseProfile.evidence_spans.map((s) => ({ span_id: s.span_id, text_excerpt: s.text_excerpt }));
  const systemPrompt =
    'You are a resume structuring engine. Output valid JSON only. Keep all fields in Chinese context. Do not fabricate evidence; use given span ids.';

  const payload = {
    task: 'extract_resume_profile',
    schema: {
      basic_profile: { full_name: 'string|null', email: 'string|null', phone: 'string|null', current_title: 'string|null', years_of_experience: 'number|null' },
      explicit_skills: [{ skill: 'string', confidence: 'number', evidence_span_ids: ['sp_1'] }],
      inferred_skills: [{ skill: 'string', inference_reason: 'string', confidence: 'number', evidence_span_ids: ['sp_2'] }],
      projects: [
        {
          project_name: 'string',
          project_summary: 'string',
          candidate_role: 'string|null',
          responsibilities: ['string'],
          tech_stack: ['string'],
          domain: 'string|null',
          complexity_level: 'low|medium|high|unknown',
          leadership_level: 'aware|used|independent|lead|unknown',
          evidence_spans: ['sp_1'],
          confidence: 'number'
        }
      ],
      work_experience: [],
      education: [],
      certifications: [],
      risk_flags: [{ type: 'string', severity: 'low|medium|high', message: 'string' }],
      extraction_confidence: { overall: 'number', by_section: { projects: 'number', skills: 'number', education: 'number' } }
    },
    file_name: fileName,
    resume_text: text.slice(0, 14000),
    evidence_spans: spans
  };

  try {
    const { json, raw } = await callUniversalLlmJson(config, systemPrompt, payload);
    const data = toObject(json);
    if (!data) {
      return { profile: baseProfile, usedLlm: false, llmRaw: raw, modelVersion: 'rule-based-bootstrap' };
    }

    const explicitSkills = Array.isArray(data.explicit_skills)
      ? (data.explicit_skills as Array<Record<string, unknown>>)
          .map((item) => ({
            skill: cleanText(item.skill) ?? '',
            confidence: Math.max(0, Math.min(1, toFiniteNumber(item.confidence, 0.75))),
            evidence_span_ids: asStringArray(item.evidence_span_ids)
          }))
          .filter((x) => x.skill.length > 0)
      : baseProfile.explicit_skills;

    const inferredSkills = Array.isArray(data.inferred_skills)
      ? (data.inferred_skills as Array<Record<string, unknown>>)
          .map((item) => ({
            skill: cleanText(item.skill) ?? '',
            inference_reason: cleanText(item.inference_reason) ?? 'LLM 推断',
            confidence: Math.max(0, Math.min(1, toFiniteNumber(item.confidence, 0.65))),
            evidence_span_ids: asStringArray(item.evidence_span_ids)
          }))
          .filter((x) => x.skill.length > 0)
      : baseProfile.inferred_skills;

    const projects = Array.isArray(data.projects)
      ? (data.projects as Array<Record<string, unknown>>)
          .map((item, index) => ({
            project_name: cleanText(item.project_name) ?? `项目经历 ${index + 1}`,
            project_summary: cleanText(item.project_summary) ?? '',
            candidate_role: cleanText(item.candidate_role),
            responsibilities: asStringArray(item.responsibilities),
            tech_stack: asStringArray(item.tech_stack).map((s) => normalizeSkill(s)),
            domain: cleanText(item.domain),
            complexity_level: (['low', 'medium', 'high', 'unknown'].includes(String(item.complexity_level)) ? String(item.complexity_level) : 'unknown') as ParsedProject['complexity_level'],
            leadership_level: (['aware', 'used', 'independent', 'lead', 'unknown'].includes(String(item.leadership_level)) ? String(item.leadership_level) : 'unknown') as ParsedProject['leadership_level'],
            evidence_spans: asStringArray(item.evidence_spans),
            confidence: Math.max(0, Math.min(1, toFiniteNumber(item.confidence, 0.75)))
          }))
          .filter((x) => x.project_name.length > 0)
      : baseProfile.projects;

    const basic = toObject(data.basic_profile) ?? {};
    const bySection = toObject(toObject(data.extraction_confidence)?.by_section) ?? {};

    const merged: ResumeProfilePayload = {
      basic_profile: {
        full_name: cleanText(basic.full_name) ?? baseProfile.basic_profile.full_name,
        email: cleanText(basic.email) ?? baseProfile.basic_profile.email,
        phone: cleanText(basic.phone) ?? baseProfile.basic_profile.phone,
        current_title: cleanText(basic.current_title) ?? baseProfile.basic_profile.current_title,
        years_of_experience:
          basic.years_of_experience == null
            ? baseProfile.basic_profile.years_of_experience
            : Math.max(0, Math.round(toFiniteNumber(basic.years_of_experience, baseProfile.basic_profile.years_of_experience ?? 0)))
      },
      explicit_skills: explicitSkills.length > 0 ? explicitSkills : baseProfile.explicit_skills,
      inferred_skills: inferredSkills,
      projects: projects.length > 0 ? projects : baseProfile.projects,
      work_experience: Array.isArray(data.work_experience) ? (data.work_experience as Array<Record<string, unknown>>) : baseProfile.work_experience,
      education: Array.isArray(data.education) ? (data.education as Array<Record<string, unknown>>) : baseProfile.education,
      certifications: Array.isArray(data.certifications) ? (data.certifications as Array<Record<string, unknown>>) : baseProfile.certifications,
      risk_flags: Array.isArray(data.risk_flags) ? (data.risk_flags as Array<Record<string, unknown>>) : baseProfile.risk_flags,
      extraction_confidence: {
        overall: Math.max(0, Math.min(1, toFiniteNumber(toObject(data.extraction_confidence)?.overall, baseProfile.extraction_confidence.overall))),
        by_section: {
          projects: Math.max(0, Math.min(1, toFiniteNumber(bySection.projects, baseProfile.extraction_confidence.by_section.projects))),
          skills: Math.max(0, Math.min(1, toFiniteNumber(bySection.skills, baseProfile.extraction_confidence.by_section.skills))),
          education: Math.max(0, Math.min(1, toFiniteNumber(bySection.education, baseProfile.extraction_confidence.by_section.education)))
        }
      },
      evidence_spans: baseProfile.evidence_spans
    };

    return { profile: merged, usedLlm: true, llmRaw: raw, modelVersion: config.modelName };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    const fallback = {
      ...baseProfile,
      risk_flags: [...baseProfile.risk_flags, { type: 'llm_fallback', severity: 'medium', message: `LLM 提炼失败，已降级规则解析: ${message}` }]
    };
    return { profile: fallback, usedLlm: false, llmRaw: { error: message }, modelVersion: 'rule-based-bootstrap' };
  }
}

function buildMatchOutput(
  profile: ResumeProfilePayload,
  requirement: ParsedJobRequirement,
  weightConfig: MatchWeightConfig
): MatchOutput {
  const candidateSkills = uniqueStrings([
    ...profile.explicit_skills.map((s) => normalizeSkill(s.skill)),
    ...profile.inferred_skills.map((s) => normalizeSkill(s.skill))
  ]);

  const mustHaveSkills = requirement.must_have_skills.map((s) => normalizeSkill(s.skill));
  const niceSkills = requirement.nice_to_have_skills.map((s) => normalizeSkill(s.skill));
  const allRequiredSkills = uniqueStrings([...mustHaveSkills, ...niceSkills]);

  const missingSkills = mustHaveSkills.filter((s) => !candidateSkills.includes(s));
  const matchedSkills = allRequiredSkills.filter((s) => candidateSkills.includes(s));

  const mustHaveBreakdown = mustHaveSkills.map((skill) => ({
    requirement: `must_have:${skill}`,
    status: (candidateSkills.includes(skill) ? 'met' : 'not_met') as 'met' | 'not_met' | 'unknown',
    reason: candidateSkills.includes(skill) ? '候选人技能中命中' : '未识别到直接证据'
  }));

  const mustHaveScore = mustHaveSkills.length === 0 ? 70 : Math.round((mustHaveBreakdown.filter((x) => x.status === 'met').length / mustHaveBreakdown.length) * 100);
  const skillScore = allRequiredSkills.length === 0 ? 70 : Math.round((matchedSkills.length / allRequiredSkills.length) * 100);

  const keywordSet = new Set(uniqueStrings([...requirement.project_keywords, ...mustHaveSkills]));
  const projectScores = profile.projects.map((project) => {
    const projectTokens = new Set(
      uniqueStrings([...project.tech_stack, ...project.project_summary.split(/\s+/).slice(0, 60)])
    );
    const hit = [...keywordSet].filter((token) => projectTokens.has(token)).length;
    const denom = Math.max(1, keywordSet.size);
    const relevanceScore = Math.min(100, Math.round((hit / denom) * 100) + (project.complexity_level === 'high' ? 10 : 0));
    return {
      project_name: project.project_name,
      relevance_score: relevanceScore,
      evidence_span_ids: project.evidence_spans
    };
  });

  const matchedProjects = [...projectScores].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 3);
  const projectRelevanceScore = matchedProjects.length === 0 ? 45 : Math.round(matchedProjects.reduce((sum, p) => sum + p.relevance_score, 0) / matchedProjects.length);

  const requiredYears = requirement.required_experience_years;
  const years = profile.basic_profile.years_of_experience;
  let experienceScore = 70;
  const requirementBreakdown = [...mustHaveBreakdown];

  if (requiredYears == null) {
    requirementBreakdown.push({ requirement: 'experience_years', status: 'unknown', reason: '岗位未设置经验年限' });
  } else if (years == null) {
    experienceScore = 50;
    requirementBreakdown.push({ requirement: `experience_years>=${requiredYears}`, status: 'unknown', reason: '候选人经验年限缺失' });
  } else if (years >= requiredYears) {
    experienceScore = Math.min(100, 80 + (years - requiredYears) * 4);
    requirementBreakdown.push({ requirement: `experience_years>=${requiredYears}`, status: 'met', reason: `候选人经验 ${years} 年` });
  } else {
    experienceScore = Math.max(20, Math.round((years / Math.max(requiredYears, 1)) * 100));
    requirementBreakdown.push({ requirement: `experience_years>=${requiredYears}`, status: 'not_met', reason: `候选人经验 ${years} 年` });
  }

  const requiredEduLevel = requirement.education_requirement.min_level;
  const candidateEduLevel = (profile.education[0]?.degree as string | undefined) ?? null;
  let educationScore = 70;

  if (!requiredEduLevel) {
    requirementBreakdown.push({ requirement: 'education_requirement', status: 'unknown', reason: '岗位未设置学历要求' });
  } else if (!candidateEduLevel) {
    educationScore = 55;
    requirementBreakdown.push({ requirement: `education>=${requiredEduLevel}`, status: 'unknown', reason: '候选人学历信息缺失' });
  } else if (educationRank(candidateEduLevel) >= educationRank(requiredEduLevel)) {
    educationScore = 95;
    requirementBreakdown.push({ requirement: `education>=${requiredEduLevel}`, status: 'met', reason: `候选人学历 ${candidateEduLevel}` });
  } else {
    educationScore = 30;
    requirementBreakdown.push({ requirement: `education>=${requiredEduLevel}`, status: 'not_met', reason: `候选人学历 ${candidateEduLevel}` });
  }

  const normalizedWeights = normalizeMatchWeights(weightConfig);
  const weightSum =
    normalizedWeights.must_have +
    normalizedWeights.skills +
    normalizedWeights.project +
    normalizedWeights.experience +
    normalizedWeights.education;
  const denom = Math.max(1, weightSum);

  const overallScore = Math.round(
    (mustHaveScore * normalizedWeights.must_have +
      skillScore * normalizedWeights.skills +
      projectRelevanceScore * normalizedWeights.project +
      experienceScore * normalizedWeights.experience +
      educationScore * normalizedWeights.education) /
      denom
  );

  const concerns = uniqueStrings([
    ...(missingSkills.length > 0 ? [`缺少关键技能: ${missingSkills.slice(0, 3).join(', ')}`] : []),
    ...profile.risk_flags.map((x) => String(x.message ?? '提取风险')),
    ...(requirementBreakdown.filter((x) => x.status === 'unknown').length > 0 ? ['存在信息缺失项，建议补充后自动重试'] : [])
  ]);

  const summaryReason =
    missingSkills.length === 0
      ? `核心技能匹配度较高，最相关项目为 ${matchedProjects[0]?.project_name ?? '暂无'}。`
      : `具备部分岗位能力，但缺少 ${missingSkills.slice(0, 2).join('、')} 等关键项。`;

  const evidenceLinks = uniqueStrings([
    ...matchedProjects.flatMap((p) => p.evidence_span_ids),
    ...profile.explicit_skills.flatMap((s) => s.evidence_span_ids.slice(0, 1))
  ]).slice(0, 12);

  return {
    overall_score: overallScore,
    recommendation: scoreToRecommendation(overallScore),
    must_have_match_score: mustHaveScore,
    skill_match_score: skillScore,
    project_relevance_score: projectRelevanceScore,
    experience_match_score: experienceScore,
    education_match_score: educationScore,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    matched_projects: matchedProjects,
    concerns,
    summary_reason: summaryReason,
    confidence: profile.extraction_confidence.overall,
    evidence_links: evidenceLinks,
    requirement_breakdown: requirementBreakdown
  };
}

async function maybeEnhanceMatchWithLlm(
  config: LlmRuntimeConfig,
  profile: ResumeProfilePayload,
  requirement: ParsedJobRequirement,
  baseMatch: MatchOutput,
  weightConfig: MatchWeightConfig
): Promise<MatchEnhancementResult> {
  if (config.mode === 'bootstrap') {
    return { match: baseMatch, usedLlm: false, llmRaw: null, modelVersion: 'rule-based-bootstrap' };
  }

  const systemPrompt =
    '你是严格的人岗匹配评估器。必须仅返回合法 JSON。所有可读文本字段（summary_reason、concerns、requirement_breakdown.reason）必须使用简体中文，不得使用英文整句。必须区分 unknown 与 not_met，并给出可解释依据与证据线索。';
  const payload = {
    task: 'match_candidate_position',
    schema: {
      overall_score: '0-100',
      recommendation: 'strong_match|partial_match|weak_match|reject',
      must_have_match_score: '0-100',
      skill_match_score: '0-100',
      project_relevance_score: '0-100',
      experience_match_score: '0-100',
      education_match_score: '0-100',
      matched_skills: ['string'],
      missing_skills: ['string'],
      matched_projects: [{ project_name: 'string', relevance_score: '0-100', evidence_span_ids: ['sp_1'] }],
      concerns: ['string'],
      summary_reason: 'string',
      confidence: '0-1',
      evidence_links: ['sp_1'],
      requirement_breakdown: [{ requirement: 'string', status: 'met|not_met|unknown', reason: 'string' }]
    },
    scoring_weights: normalizeMatchWeights(weightConfig),
    requirement,
    profile: {
      basic_profile: profile.basic_profile,
      explicit_skills: profile.explicit_skills,
      inferred_skills: profile.inferred_skills,
      projects: profile.projects,
      education: profile.education,
      risk_flags: profile.risk_flags
    }
  };

  try {
    const { json, raw } = await callUniversalLlmJson(config, systemPrompt, payload);
    const obj = toObject(json);
    if (!obj) return { match: baseMatch, usedLlm: false, llmRaw: raw, modelVersion: 'rule-based-bootstrap' };

    const enhanced: MatchOutput = {
      overall_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.overall_score, baseMatch.overall_score)))),
      recommendation: (['strong_match', 'partial_match', 'weak_match', 'reject'].includes(String(obj.recommendation))
        ? String(obj.recommendation)
        : baseMatch.recommendation) as Recommendation,
      must_have_match_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.must_have_match_score, baseMatch.must_have_match_score)))),
      skill_match_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.skill_match_score, baseMatch.skill_match_score)))),
      project_relevance_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.project_relevance_score, baseMatch.project_relevance_score)))),
      experience_match_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.experience_match_score, baseMatch.experience_match_score)))),
      education_match_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(obj.education_match_score, baseMatch.education_match_score)))),
      matched_skills: asStringArray(obj.matched_skills),
      missing_skills: asStringArray(obj.missing_skills),
      matched_projects: Array.isArray(obj.matched_projects)
        ? (obj.matched_projects as Array<Record<string, unknown>>).map((x) => ({
            project_name: cleanText(x.project_name) ?? '未知项目',
            relevance_score: Math.max(0, Math.min(100, Math.round(toFiniteNumber(x.relevance_score, 60)))),
            evidence_span_ids: asStringArray(x.evidence_span_ids)
          }))
        : baseMatch.matched_projects,
      concerns: asStringArray(obj.concerns),
      summary_reason: cleanText(obj.summary_reason) ?? baseMatch.summary_reason,
      confidence: Math.max(0, Math.min(1, toFiniteNumber(obj.confidence, baseMatch.confidence))),
      evidence_links: asStringArray(obj.evidence_links),
      requirement_breakdown: Array.isArray(obj.requirement_breakdown)
        ? (obj.requirement_breakdown as Array<Record<string, unknown>>).map((x) => ({
            requirement: cleanText(x.requirement) ?? 'unknown',
            status: (['met', 'not_met', 'unknown'].includes(String(x.status)) ? String(x.status) : 'unknown') as 'met' | 'not_met' | 'unknown',
            reason: cleanText(x.reason) ?? ''
          }))
        : baseMatch.requirement_breakdown
    };

    if (enhanced.matched_skills.length === 0) enhanced.matched_skills = baseMatch.matched_skills;
    if (enhanced.missing_skills.length === 0) enhanced.missing_skills = baseMatch.missing_skills;
    if (enhanced.evidence_links.length === 0) enhanced.evidence_links = baseMatch.evidence_links;
    if (enhanced.concerns.length === 0) enhanced.concerns = baseMatch.concerns;

    // Enforce Chinese explainability text; fallback to rule-based Chinese output when LLM returns English-only text.
    if (!containsCjk(enhanced.summary_reason) && containsCjk(baseMatch.summary_reason)) {
      enhanced.summary_reason = baseMatch.summary_reason;
    }

    const concernsAreMostlyNonChinese =
      enhanced.concerns.length > 0 && enhanced.concerns.filter((x) => containsCjk(x)).length === 0;
    if (concernsAreMostlyNonChinese && baseMatch.concerns.some((x) => containsCjk(x))) {
      enhanced.concerns = baseMatch.concerns;
    }

    enhanced.requirement_breakdown = enhanced.requirement_breakdown.map((item, idx) => {
      if (containsCjk(item.reason)) return item;
      const fallback = baseMatch.requirement_breakdown[idx];
      if (fallback && containsCjk(fallback.reason)) {
        return { ...item, reason: fallback.reason };
      }
      return item;
    });

    return { match: enhanced, usedLlm: true, llmRaw: raw, modelVersion: config.modelName };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    const fallback = {
      ...baseMatch,
      concerns: uniqueStrings([...baseMatch.concerns, `LLM 匹配失败，已降级规则打分: ${message}`])
    };
    return { match: fallback, usedLlm: false, llmRaw: { error: message }, modelVersion: 'rule-based-bootstrap' };
  }
}

function shouldReplaceAttempt(
  currentUsedLlm: boolean,
  currentConfidence: number,
  nextUsedLlm: boolean,
  nextConfidence: number,
  minGain: number
): boolean {
  if (nextUsedLlm && !currentUsedLlm) return true;
  if (nextConfidence >= currentConfidence + minGain) return true;
  return false;
}

function pickSelectedTrace(traces: LlmAttemptTrace[], selectedModel: string): LlmAttemptTrace | null {
  for (let i = traces.length - 1; i >= 0; i -= 1) {
    if (traces[i].model_name === selectedModel) return traces[i];
  }
  return traces.length > 0 ? traces[traces.length - 1] : null;
}

async function enhanceResumeProfileWithRouting(
  primaryConfig: LlmRuntimeConfig,
  fallbackConfigs: LlmRuntimeConfig[],
  routingConfig: LlmRoutingConfig,
  fileName: string,
  text: string,
  baseProfile: ResumeProfilePayload
): Promise<{ enhancement: ResumeEnhancementResult; traces: LlmAttemptTrace[]; selectedModel: string }> {
  const traces: LlmAttemptTrace[] = [];

  const runAttempt = async (
    config: LlmRuntimeConfig,
    retryReason: LlmAttemptTrace['retry_reason']
  ): Promise<{ result: ResumeEnhancementResult; confidence: number; trace: LlmAttemptTrace }> => {
    const start = Date.now();
    const result = await maybeEnhanceResumeProfileWithLlm(config, fileName, text, baseProfile);
    const durationMs = Date.now() - start;
    const confidence = Math.max(0, Math.min(1, toFiniteNumber(result.profile.extraction_confidence.overall, 0)));

    const trace: LlmAttemptTrace = {
      model_id: config.modelId,
      model_name: config.modelName,
      provider: config.provider,
      mode: config.mode,
      duration_ms: durationMs,
      used_llm: result.usedLlm,
      confidence,
      retry_reason: retryReason,
      error: extractLlmError(result.llmRaw)
    };

    return { result, confidence, trace };
  };

  let primaryRetryReason: 'provider_failure' | 'low_confidence' | null = null;
  const primaryRun = await runAttempt(primaryConfig, 'primary');
  traces.push(primaryRun.trace);

  let selectedResult = primaryRun.result;
  let selectedConfidence = primaryRun.confidence;
  let selectedModel = primaryConfig.modelName;

  primaryRetryReason = shouldRetryByReason(primaryRun.result.usedLlm, primaryRun.confidence, routingConfig);
  if (!primaryRetryReason || fallbackConfigs.length === 0) {
    return { enhancement: selectedResult, traces, selectedModel };
  }

  for (const fallbackConfig of fallbackConfigs) {
    const fallbackRun = await runAttempt(fallbackConfig, primaryRetryReason);
    traces.push(fallbackRun.trace);

    if (
      shouldReplaceAttempt(
        selectedResult.usedLlm,
        selectedConfidence,
        fallbackRun.result.usedLlm,
        fallbackRun.confidence,
        routingConfig.minConfidenceGain
      )
    ) {
      selectedResult = fallbackRun.result;
      selectedConfidence = fallbackRun.confidence;
      selectedModel = fallbackConfig.modelName;
    }

    if (fallbackRun.result.usedLlm && fallbackRun.confidence >= routingConfig.lowConfidenceThreshold) {
      break;
    }
  }

  return { enhancement: selectedResult, traces, selectedModel };
}

async function enhanceMatchWithRouting(
  primaryConfig: LlmRuntimeConfig,
  fallbackConfigs: LlmRuntimeConfig[],
  routingConfig: LlmRoutingConfig,
  profile: ResumeProfilePayload,
  requirement: ParsedJobRequirement,
  baseMatch: MatchOutput,
  weightConfig: MatchWeightConfig
): Promise<{ enhancement: MatchEnhancementResult; traces: LlmAttemptTrace[]; selectedModel: string }> {
  const traces: LlmAttemptTrace[] = [];

  const runAttempt = async (
    config: LlmRuntimeConfig,
    retryReason: LlmAttemptTrace['retry_reason']
  ): Promise<{ result: MatchEnhancementResult; confidence: number; trace: LlmAttemptTrace }> => {
    const start = Date.now();
    const result = await maybeEnhanceMatchWithLlm(config, profile, requirement, baseMatch, weightConfig);
    const durationMs = Date.now() - start;
    const confidence = Math.max(0, Math.min(1, toFiniteNumber(result.match.confidence, 0)));

    const trace: LlmAttemptTrace = {
      model_id: config.modelId,
      model_name: config.modelName,
      provider: config.provider,
      mode: config.mode,
      duration_ms: durationMs,
      used_llm: result.usedLlm,
      confidence,
      retry_reason: retryReason,
      error: extractLlmError(result.llmRaw)
    };

    return { result, confidence, trace };
  };

  const primaryRun = await runAttempt(primaryConfig, 'primary');
  traces.push(primaryRun.trace);

  let selectedResult = primaryRun.result;
  let selectedConfidence = primaryRun.confidence;
  let selectedModel = primaryConfig.modelName;

  const primaryRetryReason = shouldRetryByReason(primaryRun.result.usedLlm, primaryRun.confidence, routingConfig);
  if (!primaryRetryReason || fallbackConfigs.length === 0) {
    return { enhancement: selectedResult, traces, selectedModel };
  }

  for (const fallbackConfig of fallbackConfigs) {
    const fallbackRun = await runAttempt(fallbackConfig, primaryRetryReason);
    traces.push(fallbackRun.trace);

    if (
      shouldReplaceAttempt(
        selectedResult.usedLlm,
        selectedConfidence,
        fallbackRun.result.usedLlm,
        fallbackRun.confidence,
        routingConfig.minConfidenceGain
      )
    ) {
      selectedResult = fallbackRun.result;
      selectedConfidence = fallbackRun.confidence;
      selectedModel = fallbackConfig.modelName;
    }

    if (fallbackRun.result.usedLlm && fallbackRun.confidence >= routingConfig.lowConfidenceThreshold) {
      break;
    }
  }

  return { enhancement: selectedResult, traces, selectedModel };
}

async function updateUploadState(resumeUploadId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('resume_uploads').update(patch).eq('id', resumeUploadId);
  if (error) {
    throw new Error(`更新上传状态失败: ${error.message}`);
  }
}

function classifyPipelineErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('ocr')) {
    return 'OCR_PROVIDER_ERROR';
  }
  if (lower.includes('llm http') || lower.includes('anthropic') || lower.includes('gemini') || lower.includes('llm')) {
    return 'LLM_PROVIDER_ERROR';
  }
  if (lower.includes('上传简历文件失败') || lower.includes('storage') || lower.includes('bucket')) {
    return 'STORAGE_UPLOAD_ERROR';
  }
  if (lower.includes('文本') || lower.includes('解析')) {
    return 'TEXT_EXTRACTION_ERROR';
  }
  if (lower.includes('岗位结构化')) {
    return 'JOB_REQUIREMENT_ERROR';
  }
  if (lower.includes('创建候选人失败') || lower.includes('candidates')) {
    return 'CANDIDATE_INSERT_ERROR';
  }
  if (lower.includes('写入结构化简历失败')) {
    return 'PROFILE_PERSIST_ERROR';
  }
  if (lower.includes('写入项目经历失败')) {
    return 'PROJECTS_PERSIST_ERROR';
  }
  if (lower.includes('写入岗位匹配结果失败')) {
    return 'MATCH_PERSIST_ERROR';
  }
  return 'PHASE1_PIPELINE_ERROR';
}

async function markUploadFailed(resumeUploadId: string, message: string): Promise<void> {
  const errorCode = classifyPipelineErrorCode(message);
  let retryCount = 1;

  const { data: current } = await supabase.from('resume_uploads').select('retry_count').eq('id', resumeUploadId).single();
  const currentRetry = Number((current as Record<string, unknown> | null)?.retry_count ?? 0);
  if (Number.isFinite(currentRetry) && currentRetry >= 0) {
    retryCount = currentRetry + 1;
  }

  await supabase
    .from('resume_uploads')
    .update({
      status: 'failed',
      pipeline_stage: 'failed' as PipelineStage,
      error_code: errorCode,
      error_message: message,
      stage_finished_at: toIsoNow(),
      retry_count: retryCount
    })
    .eq('id', resumeUploadId);
}

async function markUploadCancelled(resumeUploadId: string, message: string): Promise<void> {
  await supabase
    .from('resume_uploads')
    .update({
      status: 'failed',
      pipeline_stage: 'failed' as PipelineStage,
      error_code: 'USER_CANCELLED',
      error_message: message,
      stage_finished_at: toIsoNow()
    })
    .eq('id', resumeUploadId);
}

class PipelineCancelledError extends Error {
  constructor(message = '已取消识别') {
    super(message);
    this.name = 'PipelineCancelledError';
  }
}

async function getOrCreateJobRequirement(position: ActivePositionRow): Promise<{ id: string; payload: ParsedJobRequirement }> {
  const { data: existing, error: existingError } = await supabase
    .from('parsed_job_requirements')
    .select('id, must_have_skills, nice_to_have_skills, required_experience_years, education_requirement, industry_preference, project_keywords, seniority_level, core_responsibilities, position_title')
    .eq('position_id', position.id)
    .eq('is_active', true)
    .order('version_no', { ascending: false })
    .limit(1);

  if (existingError) {
    throw new Error(`读取岗位结构化要求失败: ${existingError.message}`);
  }

  if (existing && existing.length > 0) {
    const item = existing[0] as Record<string, unknown>;
    return {
      id: String(item.id),
      payload: {
        position_title: String(item.position_title ?? position.title),
        must_have_skills: (item.must_have_skills as ParsedJobRequirement['must_have_skills']) ?? [],
        nice_to_have_skills: (item.nice_to_have_skills as ParsedJobRequirement['nice_to_have_skills']) ?? [],
        required_experience_years: (item.required_experience_years as number | null) ?? null,
        education_requirement: (item.education_requirement as ParsedJobRequirement['education_requirement']) ?? {
          min_level: position.min_edu ?? null,
          is_strict: true
        },
        industry_preference: (item.industry_preference as string[]) ?? [],
        project_keywords: (item.project_keywords as string[]) ?? [],
        seniority_level: String(item.seniority_level ?? 'mid'),
        core_responsibilities: (item.core_responsibilities as string[]) ?? []
      }
    };
  }

  const payload = buildJobRequirementFromPosition(position);

  const { data: inserted, error: insertError } = await supabase
    .from('parsed_job_requirements')
    .insert([
      {
        position_id: position.id,
        version_no: 1,
        is_active: true,
        position_title: payload.position_title,
        must_have_skills: payload.must_have_skills,
        nice_to_have_skills: payload.nice_to_have_skills,
        required_experience_years: payload.required_experience_years,
        education_requirement: payload.education_requirement,
        industry_preference: payload.industry_preference,
        project_keywords: payload.project_keywords,
        seniority_level: payload.seniority_level,
        core_responsibilities: payload.core_responsibilities,
        source_text: position.technical_requirements ?? null,
        prompt_version: 'phase1-job-v1',
        model_version: 'rule-based-bootstrap',
        pipeline_version: 'phase1'
      }
    ])
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(`创建岗位结构化要求失败: ${insertError?.message ?? 'unknown error'}`);
  }

  return { id: inserted.id as string, payload };
}

export async function runPhase1ResumePipeline(
  file: File,
  position: ActivePositionRow,
  onStageChange?: (stage: PipelineProgressStage, message: string) => void,
  options?: Phase1PipelineRunOptions
): Promise<Phase1PipelineResult> {
  if (shouldUseBackendScreening()) {
    return runPhase1ResumePipelineOnBackend(file, position, onStageChange, options);
  }

  let resumeUploadId = '';
  const ensureNotCancelled = () => {
    if (options?.shouldCancel?.()) {
      throw new PipelineCancelledError('已取消识别');
    }
  };

  try {
    ensureNotCancelled();
    const [llmConfig, ocrConfig, matchWeights, llmRouting] = await Promise.all([
      loadLlmRuntimeConfig(),
      loadOcrRuntimeConfig(),
      loadMatchWeightConfig(),
      loadLlmRoutingConfig()
    ]);
    ensureNotCancelled();
    const fallbackLlmConfigs = llmRouting.enabled ? await loadFallbackLlmRuntimeConfigs(llmConfig, llmRouting.maxFallbackModels) : [];
    const hash = await computeFileHash(file);
    const safeFileName = toSafeName(file.name);
    const uploadPath = `${position.id}/${Date.now()}-${safeFileName}`;

    const { data: uploadRow, error: createUploadError } = await supabase
      .from('resume_uploads')
      .insert([
        {
          position_id: position.id,
          file_name: file.name,
          file_path: uploadPath,
          file_size_bytes: file.size,
          mime_type: file.type || null,
          status: 'processing',
          pipeline_stage: 'uploaded',
          stage_started_at: toIsoNow(),
          file_hash: hash
        }
      ])
      .select('id')
      .single();

    if (createUploadError || !uploadRow) {
      throw new Error(`创建上传任务失败: ${createUploadError?.message ?? 'unknown error'}`);
    }

    resumeUploadId = uploadRow.id as string;
    onStageChange?.('uploaded', '文件已上传，等待文本提取');
    ensureNotCancelled();

    const { error: storageError } = await supabase.storage.from('resume-files').upload(uploadPath, file, {
      cacheControl: '3600',
      upsert: false
    });

    if (storageError) {
      throw new Error(`上传简历文件失败: ${storageError.message}`);
    }

    await updateUploadState(resumeUploadId, {
      pipeline_stage: 'text_extraction',
      status: 'processing',
      stage_started_at: toIsoNow(),
      error_code: null,
      error_message: null
    });
    ensureNotCancelled();
    onStageChange?.('text_extraction', ocrConfig.enabled ? '正在提取文本内容（必要时自动 OCR）' : '正在提取文本内容');

    const { text, quality, source } = await extractLooseText(file, ocrConfig);
    ensureNotCancelled();

    await updateUploadState(resumeUploadId, {
      pipeline_stage: 'profile_extraction',
      status: 'processing',
      stage_started_at: toIsoNow()
    });
    ensureNotCancelled();
    onStageChange?.(
      'profile_extraction',
      llmConfig.mode === 'bootstrap'
        ? '正在提炼候选人项目与技能（规则引擎）'
        : `正在提炼候选人项目与技能（LLM: ${llmConfig.modelName}）`
    );

    const { id: jobRequirementId, payload: jobRequirementPayload } = await getOrCreateJobRequirement(position);
    const bootstrapProfile = buildResumeProfile(file.name, text, quality);
    const profileRouting = await enhanceResumeProfileWithRouting(
      llmConfig,
      fallbackLlmConfigs,
      llmRouting,
      file.name,
      text,
      bootstrapProfile
    );
    const profileEnhancement = profileRouting.enhancement;
    const profilePayload = profileEnhancement.profile;
    ensureNotCancelled();

    const bootstrapMatch = buildMatchOutput(profilePayload, jobRequirementPayload, matchWeights);
    const matchRouting = await enhanceMatchWithRouting(
      llmConfig,
      fallbackLlmConfigs,
      llmRouting,
      profilePayload,
      jobRequirementPayload,
      bootstrapMatch,
      matchWeights
    );
    const matchEnhancement = matchRouting.enhancement;
    const matchOutput = matchEnhancement.match;
    ensureNotCancelled();

    await updateUploadState(resumeUploadId, {
      pipeline_stage: 'matching',
      status: 'processing',
      stage_started_at: toIsoNow()
    });
    ensureNotCancelled();
    onStageChange?.('matching', '正在与岗位要求进行匹配分析');

    const candidateName = profilePayload.basic_profile.full_name || file.name.replace(/\.(pdf|doc|docx)$/i, '') || '未命名候选人';
    const primaryEdu = (profilePayload.education[0]?.degree as string | undefined) ?? null;
    const candidateTitle = cleanText(profilePayload.basic_profile.current_title) ?? cleanText(position.title) ?? '未知职位';
    const expYears = profilePayload.basic_profile.years_of_experience;
    const candidateExpYears = typeof expYears === 'number' && Number.isFinite(expYears) && expYears >= 0 ? Math.round(expYears) : null;
    const candidateExp = typeof expYears === 'number' && Number.isFinite(expYears) && expYears >= 0 ? `${expYears}年经验` : '经验未明确';
    const candidateEdu = cleanText(primaryEdu) ?? '学历未明确';
    const candidateMatch =
      typeof matchOutput.overall_score === 'number' && Number.isFinite(matchOutput.overall_score)
        ? Math.max(0, Math.min(100, Math.round(matchOutput.overall_score)))
        : 0;
    ensureNotCancelled();

    const candidatePatch = {
      p_id: position.id,
      name: candidateName,
      title: candidateTitle,
      exp: candidateExp,
      exp_years: candidateExpYears,
      edu: candidateEdu,
      edu_level: candidateEdu,
      age: null,
      match: candidateMatch,
      prev_company: null,
      tag: recommendationToTag(matchOutput.recommendation),
      highlight: matchOutput.summary_reason
    };

    let candidateId = '';
    const { data: existingUploadRows, error: existingUploadError } = await supabase
      .from('resume_uploads')
      .select('candidate_id')
      .eq('file_hash', hash)
      .not('candidate_id', 'is', null)
      .neq('id', resumeUploadId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingUploadError) {
      throw new Error(`读取重复候选人失败: ${existingUploadError.message}`);
    }

    const existingCandidateId = existingUploadRows?.[0]?.candidate_id ? String(existingUploadRows[0].candidate_id) : null;
    if (existingCandidateId) {
      const { data: updatedCandidates, error: updateCandidateError } = await supabase
        .from('candidates')
        .update(candidatePatch)
        .eq('id', existingCandidateId)
        .select('id')
        .limit(1);

      if (updateCandidateError) {
        throw new Error(`复用候选人失败: ${updateCandidateError.message}`);
      }

      candidateId = updatedCandidates?.[0]?.id ? String(updatedCandidates[0].id) : '';
    }

    if (!candidateId) {
      const { data: candidateRow, error: candidateError } = await supabase
        .from('candidates')
        .insert([candidatePatch])
        .select('id')
        .single();

      if (candidateError || !candidateRow) {
        throw new Error(`创建候选人失败: ${candidateError?.message ?? 'unknown error'}`);
      }

      candidateId = candidateRow.id as string;
    }

    ensureNotCancelled();
    const fallbackCandidates = fallbackLlmConfigs.map((item) => item.modelName);
    const selectedProfileTrace = pickSelectedTrace(profileRouting.traces, profileRouting.selectedModel);
    const selectedMatchTrace = pickSelectedTrace(matchRouting.traces, matchRouting.selectedModel);
    const profileRoutingMeta = {
      enabled: llmRouting.enabled,
      low_confidence_threshold: llmRouting.lowConfidenceThreshold,
      min_confidence_gain: llmRouting.minConfidenceGain,
      retry_on_provider_failure: llmRouting.retryOnProviderFailure,
      fallback_candidates: fallbackCandidates,
      attempts: profileRouting.traces,
      selected_model: profileRouting.selectedModel,
      selected_model_version: profileEnhancement.modelVersion
    };
    const matchRoutingMeta = {
      enabled: llmRouting.enabled,
      low_confidence_threshold: llmRouting.lowConfidenceThreshold,
      min_confidence_gain: llmRouting.minConfidenceGain,
      retry_on_provider_failure: llmRouting.retryOnProviderFailure,
      fallback_candidates: fallbackCandidates,
      attempts: matchRouting.traces,
      selected_model: matchRouting.selectedModel,
      selected_model_version: matchEnhancement.modelVersion
    };

    const { data: profileRow, error: profileError } = await supabase
      .from('parsed_resume_profiles')
      .insert([
        {
          resume_upload_id: resumeUploadId,
          candidate_id: candidateId,
          basic_profile: profilePayload.basic_profile,
          explicit_skills: profilePayload.explicit_skills,
          inferred_skills: profilePayload.inferred_skills,
          work_experience: profilePayload.work_experience,
          education: profilePayload.education,
          certifications: profilePayload.certifications,
          risk_flags: profilePayload.risk_flags,
          extraction_confidence: profilePayload.extraction_confidence,
          parser_raw_json: {
            text_preview: text.slice(0, 1000),
            text_quality: quality,
            text_source: source,
            evidence_spans: profilePayload.evidence_spans
          },
          llm_raw_json: profileEnhancement.llmRaw
            ? {
                mode: profileEnhancement.usedLlm ? (selectedProfileTrace?.mode ?? llmConfig.mode) : 'bootstrap-fallback',
                model: profileEnhancement.modelVersion,
                payload: profileEnhancement.llmRaw,
                generated_at: toIsoNow(),
                routing: profileRoutingMeta
              }
            : {
                mode: 'phase1-rule-based-bootstrap',
                generated_at: toIsoNow(),
                routing: profileRoutingMeta
              },
          prompt_version: 'phase1-resume-v1',
          model_version: profileEnhancement.modelVersion,
          pipeline_version: 'phase1'
        }
      ])
      .select('id')
      .single();

    if (profileError || !profileRow) {
      throw new Error(`写入结构化简历失败: ${profileError?.message ?? 'unknown error'}`);
    }

    const profileId = profileRow.id as string;
    ensureNotCancelled();

    if (profilePayload.projects.length > 0) {
      const projectRows = profilePayload.projects.map((project, index) => ({
        profile_id: profileId,
        project_index: index,
        project_name: project.project_name,
        project_summary: project.project_summary,
        candidate_role: project.candidate_role,
        responsibilities: project.responsibilities,
        tech_stack: project.tech_stack,
        domain: project.domain,
        complexity_level: project.complexity_level,
        leadership_level: project.leadership_level,
        evidence_spans: project.evidence_spans,
        confidence: project.confidence
      }));

      const { error: projectsError } = await supabase.from('parsed_resume_projects').insert(projectRows);
      if (projectsError) {
        throw new Error(`写入项目经历失败: ${projectsError.message}`);
      }
    }
    ensureNotCancelled();

    const { data: matchRow, error: matchError } = await supabase
      .from('candidate_position_matches')
      .insert([
        {
          candidate_id: candidateId,
          position_id: position.id,
          profile_id: profileId,
          job_requirement_id: jobRequirementId,
          resume_upload_id: resumeUploadId,
          overall_score: matchOutput.overall_score,
          recommendation: matchOutput.recommendation,
          must_have_match_score: matchOutput.must_have_match_score,
          skill_match_score: matchOutput.skill_match_score,
          project_relevance_score: matchOutput.project_relevance_score,
          experience_match_score: matchOutput.experience_match_score,
          education_match_score: matchOutput.education_match_score,
          matched_skills: matchOutput.matched_skills,
          missing_skills: matchOutput.missing_skills,
          matched_projects: matchOutput.matched_projects,
          concerns: matchOutput.concerns,
          summary_reason: matchOutput.summary_reason,
          confidence: matchOutput.confidence,
          evidence_links: matchOutput.evidence_links,
          requirement_breakdown: matchOutput.requirement_breakdown,
          llm_raw_json: matchEnhancement.llmRaw
            ? {
                mode: matchEnhancement.usedLlm ? (selectedMatchTrace?.mode ?? llmConfig.mode) : 'bootstrap-fallback',
                model: matchEnhancement.modelVersion,
                payload: matchEnhancement.llmRaw,
                generated_at: toIsoNow(),
                routing: matchRoutingMeta
              }
            : {
                mode: 'phase1-rule-based-bootstrap',
                generated_at: toIsoNow(),
                routing: matchRoutingMeta
              },
          prompt_version: 'phase1-match-v1',
          model_version: matchEnhancement.modelVersion,
          pipeline_version: 'phase1'
        }
      ])
      .select('id')
      .single();

    if (matchError || !matchRow) {
      throw new Error(`写入岗位匹配结果失败: ${matchError?.message ?? 'unknown error'}`);
    }

    const matchId = matchRow.id as string;
    ensureNotCancelled();

    await updateUploadState(resumeUploadId, {
      candidate_id: candidateId,
      parsed_payload: {
        profile_id: profileId,
        match_id: matchId,
        overall_score: matchOutput.overall_score,
        recommendation: matchOutput.recommendation,
        summary_reason: matchOutput.summary_reason,
        extraction_confidence: profilePayload.extraction_confidence,
        llm_routing: {
          enabled: llmRouting.enabled,
          low_confidence_threshold: llmRouting.lowConfidenceThreshold,
          profile_attempts: profileRouting.traces.length,
          profile_selected_model: profileRouting.selectedModel,
          match_attempts: matchRouting.traces.length,
          match_selected_model: matchRouting.selectedModel
        }
      },
      status: 'completed',
      pipeline_stage: 'completed',
      stage_finished_at: toIsoNow(),
      error_code: null,
      error_message: null
    });
    onStageChange?.('completed', '匹配分析已完成');

    return {
      candidateId,
      resumeUploadId,
      profileId,
      matchId,
      overallScore: matchOutput.overall_score,
      recommendation: matchOutput.recommendation
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    if (resumeUploadId) {
      if (error instanceof PipelineCancelledError) {
        await markUploadCancelled(resumeUploadId, message);
      } else {
        await markUploadFailed(resumeUploadId, message);
      }
    }
    onStageChange?.('failed', message);

    throw error;
  }
}


