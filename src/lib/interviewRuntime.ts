import { supabase } from './supabase';

export type InterviewStatus = 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'failed';
export type InterviewSessionMode = 'async_qa' | 'ai_live' | 'ai_copilot';
export type InterviewSessionStatus = 'preparing' | 'ready' | 'running' | 'scoring' | 'done' | 'failed' | 'cancelled';
export type InterviewTurnSpeaker = 'system' | 'ai' | 'candidate' | 'interviewer';
export type InterviewTurnInputMode = 'text' | 'audio' | 'video' | 'metadata';
export type InterviewRecommendation = 'hire' | 'hold' | 'reject' | 'needs_review';

export interface UpcomingInterviewRow {
  id: string;
  candidate_id: string | null;
  name: string;
  stage: string | null;
  position: string | null;
  schedule_time: string | null;
  interviewer: string | null;
  location_type: string | null;
  status: InterviewStatus;
  join_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  session_id: string | null;
  ai_report_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewSessionRow {
  id: string;
  interview_id: string;
  candidate_id: string | null;
  position_id: string | null;
  mode: InterviewSessionMode;
  status: InterviewSessionStatus;
  question_plan: unknown[];
  context_payload: object;
  started_at: string | null;
  ended_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InterviewTurnRow {
  id: string;
  session_id: string;
  turn_no: number;
  speaker: InterviewTurnSpeaker;
  content: string;
  input_mode: InterviewTurnInputMode;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface InterviewReportRow {
  id: string;
  session_id: string;
  interview_id: string;
  candidate_id: string | null;
  overall_score: number | null;
  dimension_scores: Record<string, unknown>;
  strengths: unknown[];
  risks: unknown[];
  recommendation: InterviewRecommendation | null;
  evidence: unknown[];
  summary: string | null;
  risk_score: number | null;
  human_confirmed: boolean;
  human_confirmed_by: string | null;
  human_confirmed_at: string | null;
  generated_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUpcomingInterviewInput {
  candidate_id?: string | null;
  name: string;
  stage?: string | null;
  position?: string | null;
  schedule_time?: string | null;
  interviewer?: string | null;
  location_type?: string | null;
  status?: InterviewStatus;
  join_url?: string | null;
}

export interface UpdateUpcomingInterviewInput {
  candidate_id?: string | null;
  name?: string;
  stage?: string | null;
  position?: string | null;
  schedule_time?: string | null;
  interviewer?: string | null;
  location_type?: string | null;
  status?: InterviewStatus;
  join_url?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  session_id?: string | null;
  ai_report_id?: string | null;
}

export interface CreateInterviewSessionInput {
  interview_id: string;
  candidate_id?: string | null;
  position_id?: string | null;
  mode?: InterviewSessionMode;
  status?: InterviewSessionStatus;
  question_plan?: unknown[];
  context_payload?: Record<string, unknown>;
}

export interface CreateInterviewTurnInput {
  session_id: string;
  turn_no: number;
  speaker: InterviewTurnSpeaker;
  content: string;
  input_mode?: InterviewTurnInputMode;
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertInterviewReportInput {
  session_id: string;
  interview_id: string;
  candidate_id?: string | null;
  overall_score?: number | null;
  dimension_scores?: Record<string, unknown>;
  strengths?: unknown[];
  risks?: unknown[];
  recommendation?: InterviewRecommendation | null;
  evidence?: unknown[];
  summary?: string | null;
  risk_score?: number | null;
  human_confirmed?: boolean;
  human_confirmed_by?: string | null;
  human_confirmed_at?: string | null;
}

export interface PrepareInterviewPayload {
  interviewId: string;
  candidateId: string;
  positionId: string;
  mode?: InterviewSessionMode;
  questionCount?: number;
  accessToken?: string;
}

export interface StartInterviewPayload {
  interviewId: string;
  sessionId: string;
  accessToken?: string;
}

export interface AppendTurnPayload {
  sessionId: string;
  speaker: InterviewTurnSpeaker;
  content: string;
  inputMode?: InterviewTurnInputMode;
  metadata?: Record<string, unknown>;
  accessToken?: string;
}

export interface FinishInterviewPayload {
  interviewId: string;
  sessionId: string;
  accessToken?: string;
}

export interface ScoreInterviewPayload {
  interviewId: string;
  sessionId: string;
  accessToken?: string;
}

export interface ProctoringEventInput {
  eventType: string;
  severity: string;
  confidence?: number | null;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number;
  snapshotPaths?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface RecordProctoringEventsPayload {
  interviewId: string;
  sessionId: string;
  events: ProctoringEventInput[];
  accessToken?: string;
}

export interface HumanConfirmPayload {
  interviewId: string;
  reportId: string;
  confirmed: boolean;
  finalRecommendation?: InterviewRecommendation | null;
  note?: string | null;
}

const UPCOMING_INTERVIEW_COLUMNS =
  'id,candidate_id,name,stage,position,schedule_time,interviewer,location_type,status,join_url,started_at,ended_at,session_id,ai_report_id,created_by,updated_by,created_at,updated_at';

const INTERVIEW_SESSION_COLUMNS =
  'id,interview_id,candidate_id,position_id,mode,status,question_plan,context_payload,started_at,ended_at,created_by,created_at,updated_at';

const INTERVIEW_TURN_COLUMNS =
  'id,session_id,turn_no,speaker,content,input_mode,latency_ms,tokens_in,tokens_out,confidence,metadata,created_by,created_at';

const INTERVIEW_REPORT_COLUMNS =
  'id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score,human_confirmed,human_confirmed_by,human_confirmed_at,generated_by,created_at,updated_at';

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

async function resolveFunctionErrorDetail(error: unknown, fallback: string): Promise<string> {
  const base = resolveErrorMessage(error, fallback);
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return base;
  }

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('text' in context)) {
    return base;
  }

  try {
    const raw = await (context as Response).text();
    if (!raw) return base;

    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    } catch {
      // Ignore JSON parse failures and fall back to raw text.
    }

    return raw.trim() || base;
  } catch {
    return base;
  }
}

function isJwtAuthError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('invalid jwt') ||
    text.includes('jwt expired') ||
    text.includes('missing bearer token') ||
    text.includes('unauthorized')
  );
}

async function clearInvalidSession(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Ignore sign-out failures when token is already invalid.
  }
}

function assertRow<T>(data: T | null, error: unknown, fallback: string): T {
  if (error || !data) {
    throw new Error(resolveErrorMessage(error, fallback));
  }
  return data;
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return String(error.message ?? '').toLowerCase().includes('fetch');
}

function resolveFastApiBaseUrls(baseUrl: string): string[] {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  if (!normalized) return [];

  try {
    const parsed = new URL(normalized);
    const appHost = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalApiHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const isLocalAppHost = appHost === '127.0.0.1' || appHost === 'localhost';
    if (isLocalApiHost && isLocalAppHost) {
      return ['/api-fast'];
    }
  } catch {
    return [normalized];
  }

  return [normalized];
}

async function invokeEdgeFunction<TResponse>(fnName: string, payload: object): Promise<TResponse> {
  const roomAccessToken = typeof (payload as { accessToken?: unknown }).accessToken === 'string'
    ? String((payload as { accessToken?: unknown }).accessToken).trim()
    : '';
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token && !roomAccessToken) {
    throw new Error('登录状态已失效，请重新登录后再试');
  }

  const fastApiBaseUrl = (import.meta.env.VITE_FASTAPI_BASE_URL as string | undefined)?.trim().replace(/\/$/, '');
  const fastApiRoutes: Record<string, string> = {
    'interview-prepare': '/api/interviews/prepare',
    'interview-start': '/api/interviews/start',
    'interview-turn': '/api/interviews/turn',
    'interview-finish': '/api/interviews/finish',
    'interview-score': '/api/interviews/score',
    'interview-proctoring-events': '/api/interviews/proctoring-events',
    'interview-human-confirm': '/api/interviews/human-confirm'
  };

  const fastApiRoute = fastApiRoutes[fnName];
  if (fastApiBaseUrl && fastApiRoute) {
    const body = JSON.stringify(payload);
    const requestErrors: string[] = [];
    for (const baseUrl of resolveFastApiBaseUrls(fastApiBaseUrl)) {
      const url = `${baseUrl}${fastApiRoute}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            'Content-Type': 'application/json'
          },
          body
        });
      } catch (error) {
        if (!isFetchNetworkError(error)) throw error;
        requestErrors.push(`${url}: ${resolveErrorMessage(error, 'network error')}`);
        continue;
      }

      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text);
        }
      }
      if (!response.ok) {
        const detail =
          data && typeof data === 'object' && 'detail' in data ? String((data as { detail?: unknown }).detail ?? '') : '';
        throw new Error(detail || `Invoke ${fnName} failed (${response.status})`);
      }
      return data as TResponse;
    }

    throw new Error(`${fnName} 请求后端失败：${requestErrors.join('；') || `${fastApiBaseUrl}${fastApiRoute}: Failed to fetch`}`);
  }

  const invoke = async () => supabase.functions.invoke(fnName, { body: payload });

  let { data, error } = await invoke();
  if (!error) {
    return data as TResponse;
  }

  let detail = await resolveFunctionErrorDetail(error, `Invoke ${fnName} failed`);
  if (isJwtAuthError(detail)) {
    const {
      data: { session: refreshedSession },
      error: refreshError
    } = await supabase.auth.refreshSession();

    if (!refreshError && refreshedSession?.access_token) {
      ({ data, error } = await invoke());
      if (!error) {
        return data as TResponse;
      }
      detail = await resolveFunctionErrorDetail(error, `Invoke ${fnName} failed`);
    }

    await clearInvalidSession();
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.location.assign('/login');
      }, 0);
    }

    throw new Error(`登录凭证失效，已自动清理本地登录态，请重新登录后重试。${detail ? `（原始错误：${detail}）` : ''}`);
  }

  throw new Error(detail);
}

export async function createUpcomingInterview(input: CreateUpcomingInterviewInput): Promise<UpcomingInterviewRow> {
  const payload: CreateUpcomingInterviewInput = {
    ...input,
    status: input.status ?? 'scheduled'
  };

  const { data, error } = await supabase
    .from('upcoming_interviews')
    .insert([payload])
    .select(UPCOMING_INTERVIEW_COLUMNS)
    .single();

  return assertRow(data as UpcomingInterviewRow | null, error, 'Create upcoming interview failed');
}

export async function updateUpcomingInterview(
  interviewId: string,
  input: UpdateUpcomingInterviewInput
): Promise<UpcomingInterviewRow> {
  const { data, error } = await supabase
    .from('upcoming_interviews')
    .update(input)
    .eq('id', interviewId)
    .select(UPCOMING_INTERVIEW_COLUMNS)
    .single();

  return assertRow(data as UpcomingInterviewRow | null, error, 'Update upcoming interview failed');
}

export async function fetchUpcomingInterview(interviewId: string): Promise<UpcomingInterviewRow> {
  const { data, error } = await supabase
    .from('upcoming_interviews')
    .select(UPCOMING_INTERVIEW_COLUMNS)
    .eq('id', interviewId)
    .single();

  return assertRow(data as UpcomingInterviewRow | null, error, 'Fetch upcoming interview failed');
}

export async function createInterviewSession(input: CreateInterviewSessionInput): Promise<InterviewSessionRow> {
  const payload: CreateInterviewSessionInput = {
    ...input,
    mode: input.mode ?? 'async_qa',
    status: input.status ?? 'preparing',
    question_plan: input.question_plan ?? [],
    context_payload: input.context_payload ?? {}
  };

  const { data, error } = await supabase
    .from('interview_sessions')
    .insert([payload])
    .select(INTERVIEW_SESSION_COLUMNS)
    .single();

  return assertRow(data as InterviewSessionRow | null, error, 'Create interview session failed');
}

export async function updateInterviewSessionStatus(
  sessionId: string,
  status: InterviewSessionStatus,
  patch?: Pick<InterviewSessionRow, 'started_at' | 'ended_at'>
): Promise<InterviewSessionRow> {
  const { data, error } = await supabase
    .from('interview_sessions')
    .update({ status, ...(patch ?? {}) })
    .eq('id', sessionId)
    .select(INTERVIEW_SESSION_COLUMNS)
    .single();

  return assertRow(data as InterviewSessionRow | null, error, 'Update interview session status failed');
}

export async function fetchInterviewTurns(sessionId: string): Promise<InterviewTurnRow[]> {
  const { data, error } = await supabase
    .from('interview_turns')
    .select(INTERVIEW_TURN_COLUMNS)
    .eq('session_id', sessionId)
    .order('turn_no', { ascending: true });

  if (error) {
    throw new Error(resolveErrorMessage(error, 'Fetch interview turns failed'));
  }

  return (data ?? []) as InterviewTurnRow[];
}

export async function appendInterviewTurn(input: CreateInterviewTurnInput): Promise<InterviewTurnRow> {
  const payload: CreateInterviewTurnInput = {
    ...input,
    input_mode: input.input_mode ?? 'text',
    metadata: input.metadata ?? {}
  };

  const { data, error } = await supabase
    .from('interview_turns')
    .insert([payload])
    .select(INTERVIEW_TURN_COLUMNS)
    .single();

  return assertRow(data as InterviewTurnRow | null, error, 'Append interview turn failed');
}

export async function upsertInterviewReport(input: UpsertInterviewReportInput): Promise<InterviewReportRow> {
  const payload: UpsertInterviewReportInput = {
    ...input,
    dimension_scores: input.dimension_scores ?? {},
    strengths: input.strengths ?? [],
    risks: input.risks ?? [],
    evidence: input.evidence ?? []
  };

  const { data, error } = await supabase
    .from('interview_reports')
    .upsert([payload], { onConflict: 'session_id' })
    .select(INTERVIEW_REPORT_COLUMNS)
    .single();

  return assertRow(data as InterviewReportRow | null, error, 'Upsert interview report failed');
}

export async function fetchInterviewReportByInterview(interviewId: string): Promise<InterviewReportRow | null> {
  const { data, error } = await supabase
    .from('interview_reports')
    .select(INTERVIEW_REPORT_COLUMNS)
    .eq('interview_id', interviewId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(resolveErrorMessage(error, 'Fetch interview report failed'));
  }

  return ((data ?? [])[0] as InterviewReportRow | undefined) ?? null;
}

export const interviewRuntimeEdge = {
  prepareInterview: <T = unknown>(payload: PrepareInterviewPayload) =>
    invokeEdgeFunction<T>('interview-prepare', payload),
  startInterview: <T = unknown>(payload: StartInterviewPayload) =>
    invokeEdgeFunction<T>('interview-start', payload),
  appendTurn: <T = unknown>(payload: AppendTurnPayload) =>
    invokeEdgeFunction<T>('interview-turn', payload),
  finishInterview: <T = unknown>(payload: FinishInterviewPayload) =>
    invokeEdgeFunction<T>('interview-finish', payload),
  scoreInterview: <T = unknown>(payload: ScoreInterviewPayload) =>
    invokeEdgeFunction<T>('interview-score', payload),
  recordProctoringEvents: <T = unknown>(payload: RecordProctoringEventsPayload) =>
    invokeEdgeFunction<T>('interview-proctoring-events', payload),
  humanConfirm: <T = unknown>(payload: HumanConfirmPayload) =>
    invokeEdgeFunction<T>('interview-human-confirm', payload)
};



