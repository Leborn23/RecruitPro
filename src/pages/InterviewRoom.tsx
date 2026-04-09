import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Info, Play, Send, Timer } from 'lucide-react';
import { fetchInterviewReportByInterview, fetchInterviewTurns, interviewRuntimeEdge } from '../lib/interviewRuntime';
import { supabase } from '../lib/supabase';

type RoomInterviewRow = {
  id: string;
  candidate_id: string | null;
  name: string;
  stage: string | null;
  position: string | null;
  schedule_time: string | null;
  location_type: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  room_password_set_at: string | null;
  session_id: string | null;
  ai_report_id: string | null;
};

type RoomMessage = {
  speaker: 'ai' | 'candidate';
  content: string;
  kind?: string;
  answerGuidance?: string;
};

type RoomReport = {
  overall_score: number | null;
  recommendation: string | null;
  risk_score: number | null;
  summary: string | null;
  dimension_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  hire: '建议通过',
  hold: '建议保留',
  needs_review: '建议复核',
  reject: '建议淘汰'
};

const DIMENSION_LABELS: Record<string, string> = {
  role_fit: '岗位匹配度',
  technical_depth: '技术深度',
  project_evidence: '项目证据',
  problem_solving: '问题解决',
  communication: '沟通表达',
  ownership: '主导力'
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: '待开始',
  ready: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '未到场',
  failed: '异常中断'
};

const INTERVIEW_DURATION_MINUTES = 20;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function toRecommendationLabel(value?: string | null): string {
  const key = String(value ?? '').trim().toLowerCase();
  return RECOMMENDATION_LABELS[key] ?? '建议复核';
}

function toDimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key;
}

function toStatusLabel(value?: string | null): string {
  const key = String(value ?? '').trim().toLowerCase();
  return STATUS_LABELS[key] ?? (key || '待开始');
}

function normalizeDimensionScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) output[key] = Math.round(parsed);
  }
  return output;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function toReport(raw: unknown): RoomReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const overallRaw = source.overall_score;
  const riskRaw = source.risk_score;
  const overallScore = Number.isFinite(Number(overallRaw)) ? Number(overallRaw) : null;
  const riskScore = Number.isFinite(Number(riskRaw)) ? Number(riskRaw) : null;
  const recommendation = typeof source.recommendation === 'string' ? source.recommendation : null;
  const summary = typeof source.summary === 'string' ? source.summary : null;

  return {
    overall_score: overallScore,
    recommendation,
    risk_score: riskScore,
    summary,
    dimension_scores: normalizeDimensionScores(source.dimension_scores),
    strengths: normalizeStringArray(source.strengths),
    risks: normalizeStringArray(source.risks)
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '未设置';
  return value.replace('T', ' ').slice(0, 16);
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(safeSeconds / 60);
  const ss = safeSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isClosedStatus(status: string | null | undefined): boolean {
  const key = String(status ?? '').trim().toLowerCase();
  return key === 'completed' || key === 'cancelled' || key === 'failed';
}

function isSystemTransitionMessage(content: string): boolean {
  const normalized = String(content ?? '').replace(/\s+/g, '');
  if (!normalized) return false;
  return (
    normalized.includes('本轮结构化问题已完成') ||
    normalized.includes('将进入评分阶段') ||
    normalized.includes('进入评分阶段') ||
    normalized.includes('结构化初面完成')
  );
}

function getTurnKind(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const kind = (metadata as Record<string, unknown>).kind;
  return typeof kind === 'string' ? kind : '';
}

function dedupeRoomMessages(messages: RoomMessage[]): RoomMessage[] {
  const output: RoomMessage[] = [];
  const seenAiPrompts = new Set<string>();
  for (const msg of messages) {
    const normalizedContent = msg.content.trim();
    const promptSignature = `${msg.kind ?? ''}::${msg.answerGuidance ?? ''}::${normalizedContent}`;
    if (
      msg.speaker === 'ai' &&
      (msg.kind === 'question' || msg.kind === 'followup') &&
      normalizedContent
    ) {
      if (seenAiPrompts.has(promptSignature)) {
        continue;
      }
      seenAiPrompts.add(promptSignature);
    }

    const prev = output[output.length - 1];
    if (
      prev &&
      prev.speaker === msg.speaker &&
      prev.kind === msg.kind &&
      prev.answerGuidance === msg.answerGuidance &&
      prev.content.trim() === normalizedContent
    ) {
      continue;
    }
    output.push(msg);
  }
  return output;
}

export default function InterviewRoom() {
  const navigate = useNavigate();
  const { interviewId: interviewIdParam } = useParams();
  const interviewId = String(interviewIdParam ?? '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [interview, setInterview] = useState<RoomInterviewRow | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busyAction, setBusyAction] = useState<'start' | 'turn' | 'finish' | null>(null);
  const [report, setReport] = useState<RoomReport | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [totalQuestionCount, setTotalQuestionCount] = useState<number | null>(null);

  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionFinalized = hasSubmitted || isClosedStatus(interview?.status);

  const askedCount = useMemo(
    () => messages.filter((msg) => msg.speaker === 'ai' && msg.kind === 'question').length,
    [messages]
  );
  const answeredCount = useMemo(() => {
    const questionIndexes: number[] = [];
    messages.forEach((msg, index) => {
      if (msg.speaker === 'ai' && msg.kind === 'question') {
        questionIndexes.push(index);
      }
    });

    const totalQuestions = totalQuestionCount && totalQuestionCount > 0 ? totalQuestionCount : questionIndexes.length;

    let completed = 0;
    questionIndexes.forEach((questionIndex, idx) => {
      const nextQuestionIndex = idx + 1 < questionIndexes.length ? questionIndexes[idx + 1] : messages.length;
      const segment = messages.slice(questionIndex + 1, nextQuestionIndex);
      const hasCandidateReply = segment.some((msg) => msg.speaker === 'candidate');
      const movedToNextQuestion = idx + 1 < questionIndexes.length;
      const closedBySystem = segment.some((msg) => msg.speaker === 'ai' && msg.kind === 'closing');
      const reachedQuestionEnd = idx === questionIndexes.length - 1 && hasCandidateReply && questionIndexes.length >= totalQuestions;
      if (hasCandidateReply && (movedToNextQuestion || closedBySystem || reachedQuestionEnd || sessionFinalized)) {
        completed += 1;
      }
    });

    return completed;
  }, [messages, sessionFinalized, totalQuestionCount]);

  const timerView = useMemo(() => {
    const totalSeconds = INTERVIEW_DURATION_MINUTES * 60;
    if (!interview?.started_at) {
      return {
        title: '未开始',
        value: formatDuration(totalSeconds),
        hint: `默认时长 ${INTERVIEW_DURATION_MINUTES} 分钟`
      };
    }

    const startMs = new Date(interview.started_at).getTime();
    const elapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const left = totalSeconds - elapsed;

    if (left >= 0) {
      return {
        title: '剩余时间',
        value: formatDuration(left),
        hint: `已进行 ${formatDuration(elapsed)}`
      };
    }

    return {
      title: '已超时',
      value: `+${formatDuration(Math.abs(left))}`,
      hint: '建议尽快提交'
    };
  }, [interview?.started_at, nowMs]);

  const readInterview = async (id: string): Promise<RoomInterviewRow> => {
    const { data, error: queryError } = await supabase
      .from('upcoming_interviews')
      .select('id,candidate_id,name,stage,position,schedule_time,location_type,status,started_at,ended_at,room_password_set_at,session_id,ai_report_id')
      .eq('id', id)
      .single();

    if (queryError || !data) {
      throw new Error(queryError?.message ?? '找不到面试记录');
    }
    return data as RoomInterviewRow;
  };

  const syncTurns = async (sessionId: string): Promise<void> => {
    const turns = await fetchInterviewTurns(sessionId);
    const nextMessages = dedupeRoomMessages(
      turns
        .filter((turn) => {
          if (turn.speaker !== 'ai' && turn.speaker !== 'candidate') return false;
          if (turn.speaker === 'ai' && getTurnKind(turn.metadata) === 'closing') return false;
          return true;
        })
        .map((turn) => ({
          speaker: turn.speaker as 'ai' | 'candidate',
          content: turn.content,
          kind: turn.speaker === 'ai' ? getTurnKind(turn.metadata) : '',
          answerGuidance:
            turn.speaker === 'ai' && turn.metadata && typeof turn.metadata === 'object'
              ? typeof (turn.metadata as Record<string, unknown>).answer_guidance === 'string'
                ? String((turn.metadata as Record<string, unknown>).answer_guidance).trim()
                : ''
              : ''
        }))
    );
    setMessages(nextMessages);
  };

  const syncTotalQuestionCount = async (sessionId: string): Promise<void> => {
    const { data, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('question_plan')
      .eq('id', sessionId)
      .single();

    if (sessionError) {
      setTotalQuestionCount(null);
      return;
    }

    const rawPlan = (data as { question_plan?: unknown } | null)?.question_plan;
    if (!Array.isArray(rawPlan)) {
      setTotalQuestionCount(null);
      return;
    }

    setTotalQuestionCount(rawPlan.length);
  };

  const syncReport = async (id: string): Promise<void> => {
    const existing = await fetchInterviewReportByInterview(id);
    if (!existing) return;
    const parsed = toReport(existing);
    if (parsed) setReport(parsed);
  };

  const resolvePositionId = async (candidateId: string): Promise<string | null> => {
    const { data, error: queryError } = await supabase
      .from('candidates')
      .select('p_id')
      .eq('id', candidateId)
      .single();

    if (queryError) return null;
    return (data?.p_id as string | null) ?? null;
  };

  const getRoomAccessKey = (id: string) => `interview-room-auth:${id}`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!interviewId) {
        setError('缺少 interviewId，无法进入考场。');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      setNotice('');
      setConfirmSubmitOpen(false);
      setHasSubmitted(false);

      try {
        const interviewRow = await readInterview(interviewId);
        if (cancelled) return;
        setInterview(interviewRow);
        setHasSubmitted(isClosedStatus(interviewRow.status));

        const passwordSetAt = String(interviewRow.room_password_set_at ?? '').trim();
        if (!passwordSetAt) {
          setAccessGranted(true);
        } else {
          const saved = sessionStorage.getItem(getRoomAccessKey(interviewRow.id));
          setAccessGranted(saved === '1');
        }

        const sessionId = String(interviewRow.session_id ?? '').trim();
        if (sessionId) {
          await syncTurns(sessionId);
          await syncTotalQuestionCount(sessionId);
        } else {
          setMessages([]);
          setTotalQuestionCount(null);
        }

        await syncReport(interviewId);
      } catch (err) {
        if (cancelled) return;
        setError(toErrorMessage(err, '加载考场失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  useEffect(() => {
    if (!interview?.started_at) return;
    if (interview.status === 'completed' || interview.status === 'cancelled' || interview.status === 'failed') return;

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [interview?.started_at, interview?.status]);

  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const handleVerifyPassword = async () => {
    if (!interview) return;
    if (!String(interview.room_password_set_at ?? '').trim()) {
      setAccessGranted(true);
      return;
    }

    const { data, error: verifyError } = await supabase.functions.invoke('interview-room-password', {
      body: {
        action: 'verify',
        interviewId: interview.id,
        password: passwordInput.trim()
      }
    });

    if (verifyError) {
      setPasswordError(toErrorMessage(verifyError, '密码校验失败，请稍后重试。'));
      return;
    }

    const verified = Boolean((data as { verified?: unknown } | null)?.verified);
    if (verified) {
      sessionStorage.setItem(getRoomAccessKey(interview.id), '1');
      setAccessGranted(true);
      setPasswordError('');
      setNotice('密码验证通过，已进入考场。');
      return;
    }

    setPasswordError('密码错误，请重试。');
  };

  const handleStart = async () => {
    if (!interview) return;
    if (!interview.candidate_id) {
      setError('当前排期没有绑定候选人，无法启动 AI 面试。');
      return;
    }

    setBusyAction('start');
    setError('');
    setNotice('');
    try {
      const positionId = await resolvePositionId(interview.candidate_id);
      if (!positionId) {
        throw new Error('候选人未关联岗位，无法生成题目。');
      }

      const prepared = await interviewRuntimeEdge.prepareInterview<{ session_id?: string }>({
        interviewId: interview.id,
        candidateId: interview.candidate_id,
        positionId,
        mode: 'async_qa'
      });

      const sessionId = String(prepared?.session_id ?? interview.session_id ?? '').trim();
      if (!sessionId) throw new Error('prepare 阶段未返回 session_id');

      await interviewRuntimeEdge.startInterview({
        interviewId: interview.id,
        sessionId
      });

      const refreshed = await readInterview(interview.id);
      setInterview(refreshed);
      const activeSessionId = String(refreshed.session_id ?? sessionId).trim();
      if (activeSessionId) {
        await syncTurns(activeSessionId);
        await syncTotalQuestionCount(activeSessionId);
      }

      setNotice('AI 初面已启动，请按题目作答。');
    } catch (err) {
      setError(toErrorMessage(err, '启动 AI 面试失败'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmitTurn = async () => {
    if (!interview) return;
    const sessionId = String(interview.session_id ?? '').trim();
    if (!sessionId) {
      setError('尚未启动面试，请先点击“开始面试”。');
      return;
    }

    const answer = draft.trim();
    if (!answer) return;

    setBusyAction('turn');
    setError('');
    setNotice('');
    try {
      setDraft('');
      setMessages((prev) => dedupeRoomMessages([...prev, { speaker: 'candidate', content: answer }]));

      const turnResult = await interviewRuntimeEdge.appendTurn<{ ai_reply?: { content?: string; kind?: string } }>({
        sessionId,
        speaker: 'candidate',
        content: answer,
        inputMode: 'text',
        metadata: { source: 'candidate_room' }
      });

      const aiReplyKind = typeof turnResult?.ai_reply?.kind === 'string' ? turnResult.ai_reply.kind : '';
      await syncTurns(sessionId);
      await syncTotalQuestionCount(sessionId);

      const inferredTotal = totalQuestionCount && totalQuestionCount > 0 ? totalQuestionCount : askedCount;
      if (aiReplyKind === 'closing') {
        setNotice('当前题目已完成，请点击右侧“提交”生成评分报告。');
      } else if (inferredTotal > 0 && askedCount >= inferredTotal) {
        setNotice('已完成全部题目，请点击右侧“提交”生成评分报告。');
      }
    } catch (err) {
      setError(toErrorMessage(err, '提交回答失败'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleFinishAndScore = async () => {
    if (!interview) return;
    const sessionId = String(interview.session_id ?? '').trim();
    if (!sessionId) {
      setError('尚未启动面试，暂时无法提交。');
      return;
    }

    setConfirmSubmitOpen(false);
    setBusyAction('finish');
    setError('');
    setNotice('');
    try {
      await interviewRuntimeEdge.finishInterview({
        interviewId: interview.id,
        sessionId
      });

      const scored = await interviewRuntimeEdge.scoreInterview<{ report?: unknown }>({
        interviewId: interview.id,
        sessionId
      });

      const nextReport = toReport(scored?.report);
      if (nextReport) {
        setReport(nextReport);
      } else {
        await syncReport(interview.id);
      }

      const refreshed = await readInterview(interview.id);
      setInterview(refreshed);
      setHasSubmitted(true);
      setNotice('已提交，评分报告已自动生成。');
    } catch (err) {
      setError(toErrorMessage(err, '提交后自动评分失败'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestSubmit = () => {
    if (busyAction !== null) return;
    setConfirmSubmitOpen(true);
  };

  const statusKey = String(interview?.status ?? '').trim().toLowerCase();
  const isInterviewClosed = sessionFinalized;
  const hasInterviewStarted =
    Boolean(interview?.started_at) || messages.length > 0 || statusKey === 'in_progress' || statusKey === 'completed';
  const progressTotal = totalQuestionCount && totalQuestionCount > 0 ? totalQuestionCount : askedCount;
  const activePromptMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const msg = messages[index];
      if (msg.speaker !== 'ai') continue;
      if (msg.kind === 'closing') return null;
      if (msg.kind === 'question' || msg.kind === 'followup') return msg;
    }
    return null;
  }, [messages]);
  const allQuestionsAnswered = progressTotal > 0 && answeredCount >= progressTotal;
  const hasOpenPrompt = Boolean(activePromptMessage);
  const canStart = !!interview?.candidate_id && !isInterviewClosed && !hasInterviewStarted && busyAction === null;
  const canSubmit =
    hasInterviewStarted &&
    !!interview?.session_id &&
    !!draft.trim() &&
    busyAction === null &&
    !isInterviewClosed &&
    hasOpenPrompt &&
    !allQuestionsAnswered;
  const canFinish = hasInterviewStarted && !!interview?.session_id && !isInterviewClosed && busyAction === null;
  const answerLocked = isInterviewClosed || busyAction === 'finish' || !hasOpenPrompt || allQuestionsAnswered;
  const completionRate = progressTotal > 0 ? Math.min(100, Math.round((answeredCount / progressTotal) * 100)) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-container-low flex items-center justify-center p-6">
        <div className="text-sm text-on-surface-variant">正在加载线上考场...</div>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen bg-surface-container-low flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error space-y-3">
          <p>{error || '考场不存在或无权限访问。'}</p>
          <button
            onClick={() => navigate('/interviews')}
            className="inline-flex items-center gap-2 rounded bg-surface-container-high px-3 py-1.5 text-on-surface hover:bg-surface-container-high/80 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> 返回面试中控
          </button>
        </div>
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div className="min-h-screen bg-surface-container-low flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5 space-y-4">
          <h2 className="text-lg font-semibold text-on-surface">进入候选人考场</h2>
          <p className="text-sm text-on-surface-variant">该场次已设置访问密码，请输入密码后进入。</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleVerifyPassword();
              }
            }}
            placeholder="请输入考场密码"
            className="w-full rounded-md border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm outline-none focus:border-primary"
          />
          {passwordError && <p className="text-xs text-error">{passwordError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void handleVerifyPassword()}
              className="flex-1 rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              验证并进入
            </button>
            <button
              onClick={() => navigate('/interviews')}
              className="rounded-md bg-surface-container-high text-on-surface px-3 py-2 text-sm hover:bg-surface-container-high/80 transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-container-low py-6">
      <div className="max-w-5xl mx-auto px-4 space-y-4">
        <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-on-surface">AI 线上考场</h1>
            <p className="text-sm text-on-surface-variant">
              候选人：{interview.name} · 岗位：{interview.position || '未填写'} · 场次：{interview.stage || '未设置'}
            </p>
            <p className="text-xs text-on-surface-variant">
              面试时间：{formatDateTime(interview.schedule_time)} · 当前状态：{toStatusLabel(interview.status)}
            </p>
          </div>
          <button
            onClick={() => navigate('/interviews')}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-surface-container-high text-on-surface text-sm hover:bg-surface-container-high/80 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> 返回中控
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {notice}
          </div>
        )}

        {confirmSubmitOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4"
            onClick={() => setConfirmSubmitOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-outline-variant/15 bg-surface-container-low/40 flex items-start gap-3">
                <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-error/10 text-error shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-on-surface">确认提交本场面试？</h3>
                  <p className="text-sm text-on-surface-variant">提交后将自动评分，且无法继续作答。</p>
                </div>
              </div>

              <div className="px-5 py-3 text-sm text-on-surface-variant bg-surface-container-low border-b border-outline-variant/15">
                请确认当前回答已完成，再执行提交。
              </div>

              <div className="px-5 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => setConfirmSubmitOpen(false)}
                  className="rounded-md bg-surface-container-high text-on-surface px-3 py-2 text-sm hover:bg-surface-container-high/80 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => void handleFinishAndScore()}
                  disabled={busyAction !== null}
                  className="rounded-md bg-primary text-white px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busyAction === 'finish' ? '提交中...' : '确认提交'}
                </button>
              </div>
            </div>
          </div>
        )}

        {!hasInterviewStarted && !isInterviewClosed ? (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-6 space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-on-surface">欢迎进入 AI 面试考场</h2>
              <p className="text-sm text-on-surface-variant">
                请先点击“开始面试”，开始后进入正式答题。
              </p>
            </div>

            <div className="inline-flex items-center rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2">
              <p className="text-sm text-on-surface-variant">
                面试时长 <span className="font-semibold text-on-surface">{INTERVIEW_DURATION_MINUTES} 分钟</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleStart()}
                disabled={!canStart}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-white px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                {busyAction === 'start' ? '启动中...' : '开始面试'}
              </button>
              <button
                onClick={() => navigate('/interviews')}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-surface-container-high text-on-surface px-4 py-2.5 text-sm hover:bg-surface-container-high/80 transition-colors"
              >
                稍后再开始
              </button>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-on-surface">对话记录</h2>
                <span className="text-xs text-on-surface-variant">已提问 {askedCount} · 已完成 {answeredCount}</span>
              </div>

              <div className="h-[360px] overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container-low p-3 space-y-2">
                {messages.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">
                    {busyAction === 'start' ? '正在生成第 1 题，请稍候...' : '暂未收到题目，请稍候。'}
                  </p>
                ) : (
                  messages.map((msg, idx) => (
                    (() => {
                      const isCandidate = msg.speaker === 'candidate';
                      const isSystem = !isCandidate && isSystemTransitionMessage(msg.content);
                      if (isSystem) {
                        return (
                          <div
                            key={`room-msg-${idx}`}
                            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                          >
                            <p className="font-semibold mb-1 inline-flex items-center gap-1.5 text-amber-800">
                              <Info className="w-4 h-4" />
                              系统提示
                            </p>
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          </div>
                        );
                      }

                      return (
                        <div key={`room-msg-${idx}`} className={`flex ${isCandidate ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[92%] md:max-w-[86%] rounded-md border px-3 py-2 text-sm ${
                              isCandidate
                                ? 'bg-primary/10 border-primary/20 text-primary'
                                : 'bg-surface-container-high border-outline-variant/20 text-on-surface'
                            }`}
                          >
                            <p className="font-semibold mb-1">{isCandidate ? '候选人' : 'AI 面试官'}</p>
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          </div>
                        </div>
                      );
                    })()
                  ))
                )}
              </div>

              {activePromptMessage?.answerGuidance ? (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                  <p className="text-xs font-semibold text-primary mb-1">当前作答提醒</p>
                  <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">
                    {activePromptMessage.answerGuidance}
                  </p>
                </div>
              ) : null}

              <div className="mt-3 flex items-end gap-2">
                <textarea
                  ref={draftRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={answerLocked}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmitTurn();
                    }
                  }}
                  rows={1}
                  placeholder={answerLocked ? '已提交，无法继续作答' : '输入你的回答，Enter 发送，Shift+Enter 换行'}
                  className="flex-1 min-h-[42px] max-h-[180px] resize-none overflow-y-auto rounded-md border border-outline-variant/25 bg-surface-container-lowest px-3 py-2 text-sm leading-6 outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  onClick={() => void handleSubmitTurn()}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" /> {busyAction === 'turn' ? '发送中...' : '发送回答'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4 space-y-3 h-fit">
              <h2 className="text-sm font-semibold text-on-surface">操作</h2>

              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2">
                <p className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5" /> {timerView.title}
                </p>
                <p className="text-xl font-semibold text-on-surface leading-tight">{timerView.value}</p>
                <p className="text-[11px] text-on-surface-variant">{timerView.hint}</p>
              </div>

              <button
                onClick={handleRequestSubmit}
                disabled={!canFinish}
                className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-white px-4 text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                {busyAction === 'finish' ? '提交中...' : '提交'}
              </button>

              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-3 space-y-2">
                <p className="text-xs font-semibold text-on-surface">本场进度</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-surface-container-lowest border border-outline-variant/15 px-2 py-1.5">
                    <p className="text-[10px] text-on-surface-variant">总题目</p>
                    <p className="text-sm font-semibold text-on-surface">{progressTotal || '-'}</p>
                  </div>
                  <div className="rounded-md bg-surface-container-lowest border border-outline-variant/15 px-2 py-1.5">
                    <p className="text-[10px] text-on-surface-variant">已完成</p>
                    <p className="text-sm font-semibold text-on-surface">{answeredCount}</p>
                  </div>
                  <div className="rounded-md bg-surface-container-lowest border border-outline-variant/15 px-2 py-1.5">
                    <p className="text-[10px] text-on-surface-variant">完成率</p>
                    <p className="text-sm font-semibold text-on-surface">{completionRate}%</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant">当前状态</span>
                  <span className="font-semibold text-on-surface">{toStatusLabel(interview.status)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant">作答状态</span>
                  <span className={`font-semibold ${answerLocked ? 'text-error' : 'text-primary'}`}>
                    {answerLocked ? '已锁定' : '可继续作答'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {report && (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4 space-y-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-xs text-on-surface-variant">总分</p>
                <p className="text-2xl font-bold text-on-surface">{report.overall_score ?? '-'}</p>
              </div>
              <div className="text-xs px-2.5 py-1 rounded border border-primary/20 bg-primary/10 text-primary font-semibold">
                {toRecommendationLabel(report.recommendation)}
              </div>
              <div className="text-xs text-on-surface-variant">风险评分：{report.risk_score ?? '-'}</div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-on-surface mb-2">维度评分</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {Object.entries(report.dimension_scores).map(([dimension, score]) => (
                  <div key={dimension} className="rounded border border-outline-variant/20 px-3 py-2 text-xs flex justify-between bg-surface-container-low">
                    <span className="text-on-surface-variant">{toDimensionLabel(dimension)}</span>
                    <span className="font-semibold text-on-surface">{score}</span>
                  </div>
                ))}
              </div>
            </div>

            {report.summary && (
              <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs text-on-surface whitespace-pre-wrap">
                {report.summary}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}




