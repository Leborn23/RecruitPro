import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, Info, Play, Send, ShieldCheck, Timer } from 'lucide-react';
import { useInterviewProctoring } from '../hooks/useInterviewProctoring';
import { fetchInterviewReportByInterview, fetchInterviewTurns, interviewRuntimeEdge } from '../lib/interviewRuntime';
import { getInterviewDurationMinutesForQuestionCount } from '../lib/interviewDuration';
import { DEFAULT_INTERVIEW_QUESTION_COUNT, normalizeInterviewQuestionCount } from '../lib/interviewQuestionCount';
import { deriveInterviewClockView, deriveInterviewQuestionMetrics, deriveInterviewStartState } from '../lib/interviewRoomState';
import { normalizeReportText } from '../lib/reportText';
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
  evidence: unknown[];
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

function isAgentSystemErrorMessage(content: string): boolean {
  const text = content.trim().toLowerCase();
  return text.includes('session already exists') || text.includes('agent gateway request failed');
}

function toReport(raw: unknown): RoomReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const overallRaw = source.overall_score;
  const riskRaw = source.risk_score;
  const overallScore = overallRaw == null ? null : Number.isFinite(Number(overallRaw)) ? Number(overallRaw) : null;
  const riskScore = riskRaw == null ? null : Number.isFinite(Number(riskRaw)) ? Number(riskRaw) : null;
  const recommendation = typeof source.recommendation === 'string' ? source.recommendation : null;
  const summary = typeof source.summary === 'string' ? normalizeReportText(source.summary) : null;

  return {
    overall_score: overallScore,
    recommendation,
    risk_score: riskScore,
    summary,
    dimension_scores: normalizeDimensionScores(source.dimension_scores),
    strengths: normalizeStringArray(source.strengths),
    risks: normalizeStringArray(source.risks),
    evidence: Array.isArray(source.evidence) ? source.evidence : []
  };
}

function getProctoringEvidence(report: RoomReport): Array<{
  summary: string;
  eventCount: number;
  riskScore: number;
  snapshotPaths: string[];
  details: Array<{
    eventType: string;
    label: string;
    severity: string;
    category: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    faceCount: number | null;
    faceScore: number | null;
    attentionSignal: string;
    poseSignal: string;
    headPose: {
      yaw: number | null;
      pitch: number | null;
      roll: number | null;
    };
    landmarkCount: number | null;
  }>;
}> {
  return report.evidence
    .filter((item): item is Record<string, unknown> => {
      return Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'proctoring');
    })
    .map((item) => {
      const eventCount = Number(item.event_count);
      const riskScore = Number(item.risk_score);
      const rawDetails = Array.isArray(item.details) ? item.details : [];
      return {
        summary: typeof item.summary === 'string' ? item.summary : '',
        eventCount: Number.isFinite(eventCount) ? Math.round(eventCount) : 0,
        riskScore: Number.isFinite(riskScore) ? Math.round(riskScore) : 0,
        snapshotPaths: normalizeStringArray(item.snapshot_paths),
        details: rawDetails
          .filter((detail): detail is Record<string, unknown> => Boolean(detail && typeof detail === 'object'))
          .map((detail) => {
            const durationMs = Number(detail.duration_ms ?? 0);
            const faceCount = detail.face_count == null ? null : Number(detail.face_count);
            const faceScore = detail.face_score == null ? null : Number(detail.face_score);
            const rawHeadPose =
              detail.head_pose && typeof detail.head_pose === 'object' && !Array.isArray(detail.head_pose)
                ? (detail.head_pose as Record<string, unknown>)
                : {};
            return {
              eventType: String(detail.event_type ?? '').trim(),
              label: String(detail.label ?? detail.event_type ?? '未知监考事件').trim(),
              severity: String(detail.severity ?? '').trim(),
              category: String(detail.category ?? '').trim(),
              startedAt: formatDateTime(String(detail.started_at ?? '')),
              endedAt: formatDateTime(String(detail.ended_at ?? '')),
              durationMs: Number.isFinite(durationMs) ? durationMs : 0,
              faceCount: Number.isFinite(faceCount) ? faceCount : null,
              faceScore: Number.isFinite(faceScore) ? faceScore : null,
              attentionSignal: String(detail.attention_signal ?? '').trim(),
              poseSignal: String(detail.pose_signal ?? '').trim(),
              headPose: {
                yaw: readProctoringNumber(rawHeadPose.yaw),
                pitch: readProctoringNumber(rawHeadPose.pitch),
                roll: readProctoringNumber(rawHeadPose.roll)
              },
              landmarkCount: readProctoringNumber(detail.landmark_count)
            };
          })
      };
    });
}

function readProctoringNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toProctoringSeverityLabel(value: string): string {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  if (value === 'low') return '低';
  return value || '-';
}

function toProctoringAttentionLabel(value: string): string {
  if (value === 'face_near_edge') return '人脸贴近画面边缘';
  if (value === 'face_too_small') return '人脸面积过小';
  if (value === 'face_centered') return '人脸居中';
  if (value === 'missing_face_bounds') return '缺少人脸框';
  return value;
}

function toProctoringPoseLabel(value: string): string {
  if (value === 'head_turned_left') return '头部向左偏转';
  if (value === 'head_turned_right') return '头部向右偏转';
  if (value === 'head_down') return '长时间低头';
  if (value === 'head_up') return '长时间抬头';
  if (value === 'face_occluded') return '人脸关键点遮挡';
  if (value === 'head_forward') return '正对摄像头';
  return value;
}

function formatProctoringPoseValue(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)}°`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace('T', ' ').slice(0, 19);
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function isScreenSwitchDetail(detail: { eventType: string; category: string }): boolean {
  return detail.category === 'screen_switch' || detail.eventType === 'page_hidden' || detail.eventType === 'window_blur';
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
  const [configuredQuestionCount, setConfiguredQuestionCount] = useState(DEFAULT_INTERVIEW_QUESTION_COUNT);

  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionFinalized = hasSubmitted || isClosedStatus(interview?.status);
  const proctoring = useInterviewProctoring({
    interviewId,
    sessionId: interview?.session_id ?? null,
    enabled: accessGranted && !sessionFinalized
  });

  const progressMetrics = useMemo(
    () => deriveInterviewQuestionMetrics(messages, totalQuestionCount, sessionFinalized),
    [messages, sessionFinalized, totalQuestionCount]
  );
  const askedCount = progressMetrics.askedCount;
  const answeredCount = progressMetrics.completedCount;
  const progressTotal = progressMetrics.totalCount;
  const completionRate = progressMetrics.completionRate;
  const effectiveQuestionCount =
    (totalQuestionCount && totalQuestionCount > 0 ? totalQuestionCount : configuredQuestionCount) || DEFAULT_INTERVIEW_QUESTION_COUNT;
  const interviewDurationMinutes = getInterviewDurationMinutesForQuestionCount(effectiveQuestionCount);

  const timerView = useMemo(
    () =>
      deriveInterviewClockView({
        startedAt: interview?.started_at,
        nowMs,
        durationMinutes: interviewDurationMinutes,
        closed: sessionFinalized
      }),
    [interview?.started_at, interviewDurationMinutes, nowMs, sessionFinalized]
  );

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

  const syncTurns = async (sessionId: string): Promise<RoomMessage[]> => {
    const turns = await fetchInterviewTurns(sessionId);
    const nextMessages = dedupeRoomMessages(
      turns
        .filter((turn) => {
          if (turn.speaker !== 'ai' && turn.speaker !== 'candidate') return false;
          if (turn.speaker === 'ai' && isAgentSystemErrorMessage(turn.content)) return false;
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
    return nextMessages;
  };

  const syncTotalQuestionCount = async (sessionId: string): Promise<number | null> => {
    const { data, error: sessionError } = await supabase
      .from('interview_sessions')
      .select('question_plan')
      .eq('id', sessionId)
      .single();

    if (sessionError) {
      setTotalQuestionCount(null);
      return null;
    }

    const rawPlan = (data as { question_plan?: unknown } | null)?.question_plan;
    if (!Array.isArray(rawPlan)) {
      setTotalQuestionCount(null);
      return null;
    }

    setTotalQuestionCount(rawPlan.length);
    return rawPlan.length;
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

  const resolveInterviewQuestionCount = async (): Promise<number> => {
    const { data } = await supabase.from('company_settings').select('interview_question_count').single();
    return normalizeInterviewQuestionCount((data as { interview_question_count?: unknown } | null)?.interview_question_count);
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
        const questionCount = await resolveInterviewQuestionCount();
        if (!cancelled) setConfiguredQuestionCount(questionCount);

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
      const questionCount = await resolveInterviewQuestionCount();

      const prepared = await interviewRuntimeEdge.prepareInterview<{ session_id?: string }>({
        interviewId: interview.id,
        candidateId: interview.candidate_id,
        positionId,
        mode: 'async_qa',
        questionCount
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
      const nextMessages = await syncTurns(sessionId);
      const nextTotal = await syncTotalQuestionCount(sessionId);
      const nextMetrics = deriveInterviewQuestionMetrics(nextMessages, nextTotal, false);

      if (aiReplyKind === 'closing') {
        setNotice('当前题目已完成，请点击右侧“提交”生成评分报告。');
      } else if (nextMetrics.totalCount > 0 && nextMetrics.completedCount >= nextMetrics.totalCount) {
        setNotice('已完成全部题目，请点击右侧“提交”生成评分报告。');
      }
    } catch (err) {
      setDraft(answer);
      setMessages((prev) => {
        const next = [...prev];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          const msg = next[index];
          if (msg.speaker === 'candidate' && msg.content === answer) {
            next.splice(index, 1);
            break;
          }
        }
        return next;
      });
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
      await proctoring.flushEvents();

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

  const isInterviewClosed = sessionFinalized;
  const { hasInterviewStarted } = deriveInterviewStartState({
    messages,
    startedAt: interview?.started_at,
    status: interview?.status,
    sessionId: interview?.session_id
  });
  const activePromptMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const msg = messages[index];
      if (msg.speaker !== 'ai') continue;
      if (msg.kind === 'closing') return null;
      if (msg.kind === 'question' || msg.kind === 'followup') return msg;
    }
    return null;
  }, [messages]);
  const hasOpenPrompt = Boolean(activePromptMessage);
  const allQuestionsAnswered = progressTotal > 0 && answeredCount >= progressTotal && !hasOpenPrompt;
  const isOvertime = timerView.state === 'overtime';
  const proctoringRunning = proctoring.status === 'ready' || proctoring.status === 'warning';
  const proctoringReady = proctoring.status === 'ready';
  const proctoringRequesting = proctoring.status === 'requesting';
  const proctoringStartDisabled = !proctoring.consented || proctoringRequesting || proctoringRunning;
  const ProctoringStatusIcon = proctoringReady
    ? ShieldCheck
    : proctoring.status === 'blocked' || proctoring.status === 'error'
      ? CameraOff
      : Camera;
  const proctoringStatusClass = proctoringReady
    ? 'border-primary/20 bg-primary/10 text-primary'
    : proctoring.status === 'blocked' || proctoring.status === 'error'
      ? 'border-error/20 bg-[#fff6f8] text-error'
      : proctoring.status === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-800'
        : 'border-[#d6e2f1] bg-white text-[#4b6b90]';
  const screenSwitchStatusClass = proctoring.screenSwitch.active
    ? 'border-amber-300 bg-amber-50 text-amber-800'
    : proctoring.screenSwitch.eventCount > 0
      ? 'border-amber-200 bg-amber-50/70 text-amber-800'
      : 'border-primary/20 bg-primary/10 text-primary';
  const canStart =
    !!interview?.candidate_id &&
    !isInterviewClosed &&
    !hasInterviewStarted &&
    busyAction === null &&
    proctoring.consented &&
    proctoringReady;
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
  const currentQuestionLabel = !hasInterviewStarted
    ? '未开始'
    : progressTotal > 0
      ? allQuestionsAnswered
        ? `已完成 ${progressTotal}/${progressTotal}`
        : `第 ${Math.min(answeredCount + 1, progressTotal)} / ${progressTotal} 题`
      : askedCount > 0
        ? `已提问 ${askedCount} 题`
        : '等待第 1 题';
  const saveStatusLabel =
    busyAction === 'turn'
      ? '正在保存本题回答'
      : messages.some((msg) => msg.speaker === 'candidate')
        ? '最近一次回答已记录'
        : draft.trim()
          ? '草稿未发送'
          : '发送后立即记录';
  const submissionRuleLabel = isInterviewClosed
    ? '本场已提交，不可继续编辑'
    : isOvertime
      ? '已超时，仍可继续作答并生成后续题目'
      : allQuestionsAnswered
        ? '题目已完成，请直接提交'
        : '回答当前题目后可继续下一题';
  const roomStateLabel = isInterviewClosed
    ? '已提交'
    : isOvertime
      ? '超时待提交'
      : allQuestionsAnswered
        ? '待提交'
        : hasOpenPrompt
          ? '作答中'
          : '等待题目';
  const proctoringEvidence = report ? getProctoringEvidence(report) : [];

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
    <div className="min-h-screen bg-[#f5f9ff] py-6">
      <div className="max-w-6xl mx-auto px-4 space-y-5">
        <div className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:p-6">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#426a9a]">
                <Timer className="h-3.5 w-3.5" />
                Interview Room
              </div>
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight text-[#16355f]">在线考核控制台</h1>
                <p className="text-sm text-[#5d7896]">
                  候选人：{interview.name} · 岗位：{interview.position || '未填写'} · 场次：{interview.stage || '未设置'}
                </p>
                <p className="text-sm text-[#5d7896]">
                  面试时间：{formatDateTime(interview.schedule_time)} · 当前状态：{toStatusLabel(interview.status)}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-4 py-3">
                  <p className="text-[11px] text-[#6b86a4]">当前题目</p>
                  <p className="mt-1 text-lg font-semibold text-[#16355f]">{currentQuestionLabel}</p>
                  <p className="mt-1 text-xs text-[#6b86a4]">已提问 {askedCount} · 已完成 {answeredCount}</p>
                </div>
                <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-4 py-3">
                  <p className="text-[11px] text-[#6b86a4]">{timerView.title}</p>
                  <p className={`mt-1 text-lg font-semibold ${isOvertime ? 'text-[#c43d4b]' : 'text-[#16355f]'}`}>{timerView.value}</p>
                  <p className="mt-1 text-xs text-[#6b86a4]">{timerView.hint}</p>
                </div>
                <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-4 py-3">
                  <p className="text-[11px] text-[#6b86a4]">保存状态</p>
                  <p className="mt-1 text-lg font-semibold text-[#16355f]">{saveStatusLabel}</p>
                  <p className="mt-1 text-xs text-[#6b86a4]">发送回答后立即写入记录</p>
                </div>
                <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-4 py-3">
                  <p className="text-[11px] text-[#6b86a4]">提交规则</p>
                  <p className="mt-1 text-lg font-semibold text-[#16355f]">{roomStateLabel}</p>
                  <p className="mt-1 text-xs text-[#6b86a4]">{submissionRuleLabel}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-3 py-3">
                  <p className="text-[11px] text-[#6b86a4]">总题目</p>
                  <p className="text-lg font-semibold text-[#16355f]">{progressTotal || '-'}</p>
                </div>
                <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-3 py-3">
                  <p className="text-[11px] text-[#6b86a4]">已完成</p>
                  <p className="text-lg font-semibold text-[#16355f]">{answeredCount}</p>
                </div>
                <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-3 py-3">
                  <p className="text-[11px] text-[#6b86a4]">完成率</p>
                  <p className="text-lg font-semibold text-[#16355f]">{completionRate}%</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate('/interviews')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#c7daf6] bg-white px-3 py-2 text-sm font-medium text-[#355b87] hover:bg-[#eef5ff] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回中控
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-[20px] border border-error/20 bg-[#fff6f8] px-4 py-3 text-sm text-error flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-[20px] border border-[#c7daf6] bg-[#f4f8ff] px-4 py-3 text-sm text-[#1f5fbf] flex items-center gap-2">
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
              className="w-full max-w-lg rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-[0_16px_36px_-24px_rgba(21,53,102,0.18)] overflow-hidden"
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
          <div className="rounded-[28px] border border-[#cddcf0] bg-white p-6 space-y-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-on-surface">欢迎进入 AI 面试考场</h2>
              <p className="text-sm text-on-surface-variant">
                请先点击“开始面试”，开始后进入正式答题。
              </p>
            </div>

            <div className="inline-flex items-center rounded-[16px] border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2">
              <p className="text-sm text-[#5d7896]">
                面试时长 <span className="font-semibold text-[#16355f]">{interviewDurationMinutes} 分钟</span>
              </p>
            </div>

            <div className="rounded-[22px] border border-[#d6e2f1] bg-[#f7fbff] p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[#16355f]">
                    <ShieldCheck className="w-4 h-4" />
                    摄像头监考
                  </h3>
                  <p className="text-xs text-[#6b86a4]">仅保存异常关键帧，不进行全程录像。</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${proctoringStatusClass}`}>
                  <ProctoringStatusIcon className="w-3.5 h-3.5" />
                  {proctoring.statusText}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-3">
                  <label className="flex items-start gap-2 rounded-[16px] border border-[#d6e2f1] bg-white px-3 py-3 text-sm text-[#355b87]">
                    <input
                      type="checkbox"
                      checked={proctoring.consented}
                      onChange={(event) => proctoring.setConsented(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-[#c7daf6] text-primary focus:ring-primary"
                    />
                    <span>
                      我同意在本场面试中开启摄像头监考，并知悉系统仅保存异常关键帧，不进行全程录像。
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void proctoring.start()}
                    disabled={proctoringStartDisabled}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-white border border-[#c7daf6] px-4 py-2.5 text-sm font-semibold text-[#355b87] hover:bg-[#eef5ff] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Camera className="w-4 h-4" />
                    {proctoringRequesting ? '正在打开摄像头...' : proctoringRunning ? '摄像头已就绪' : '打开摄像头'}
                  </button>
                  <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${screenSwitchStatusClass}`}>
                    <AlertCircle className="w-3.5 h-3.5" />
                    {proctoring.screenSwitch.statusText}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-[18px] border border-[#c7daf6] bg-[#0f172a] aspect-video">
                  <video
                    ref={proctoring.videoRef}
                    muted
                    playsInline
                    className="h-full w-full object-fill"
                  />
                  {proctoring.faceBox ? (
                    <div
                      className={`absolute border-2 ${proctoring.faceBox.state === 'warning' ? 'border-amber-300 shadow-[0_0_0_9999px_rgba(180,83,9,0.16)]' : 'border-emerald-300 shadow-[0_0_0_9999px_rgba(16,185,129,0.08)]'}`}
                      style={{
                        left: `${proctoring.faceBox.x * 100}%`,
                        top: `${proctoring.faceBox.y * 100}%`,
                        width: `${proctoring.faceBox.width * 100}%`,
                        height: `${proctoring.faceBox.height * 100}%`,
                      }}
                    />
                  ) : proctoringRunning ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-xs font-semibold text-white">
                      未检测到人脸框
                    </div>
                  ) : null}
                  {proctoring.faceBox ? (
                    <div className={`absolute bottom-2 left-2 rounded px-2 py-1 text-[11px] font-semibold text-white shadow-sm ${proctoring.faceBox.state === 'warning' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                      {proctoring.faceBox.label}
                    </div>
                  ) : null}
                </div>
              </div>
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
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_360px]">
            <div className="rounded-[28px] border border-[#cddcf0] bg-white p-4 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#16355f]">对话记录</h2>
                  <p className="text-xs text-[#6b86a4]">题量、进度和侧栏操作均按同一统计口径展示</p>
                </div>
                <span className="inline-flex items-center rounded-full border border-[#d6e2f1] bg-[#f7fbff] px-3 py-1 text-xs font-medium text-[#4b6b90]">
                  已提问 {askedCount} · 已完成 {answeredCount} · 总题目 {progressTotal || '-'}
                </span>
              </div>

              <div className="h-[min(68vh,620px)] overflow-y-auto rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] p-4 pr-3 space-y-3">
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
                            className={`max-w-[min(88%,42rem)] rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                              isCandidate
                                ? 'bg-primary/10 border-primary/20 text-primary'
                                : 'bg-surface-container-high border-outline-variant/20 text-on-surface'
                            }`}
                          >
                            <p className="font-semibold mb-1">{isCandidate ? '候选人' : 'AI 面试官'}</p>
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">{msg.content}</p>
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
                  placeholder={
                    isInterviewClosed
                      ? '已提交，无法继续作答'
                      : isOvertime
                        ? '已超时，仍可继续作答，Enter 发送'
                        : allQuestionsAnswered
                          ? '题目已全部完成，请直接提交'
                          : '输入你的回答，Enter 发送，Shift+Enter 换行'
                  }
                  className="flex-1 min-h-[42px] max-h-[180px] resize-none overflow-y-auto rounded-xl border border-[#d6e2f1] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  onClick={() => void handleSubmitTurn()}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" /> {busyAction === 'turn' ? '发送中...' : '发送回答'}
                </button>
              </div>
              <p className="mt-2 text-xs text-[#6b86a4]">{submissionRuleLabel}</p>
            </div>

            <div className="rounded-[28px] border border-[#cddcf0] bg-white p-4 space-y-4 h-fit shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)] xl:sticky xl:top-6">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-[#16355f]">操作</h2>
                <p className="text-xs text-[#6b86a4]">超时后不会自动提交，需手动确认提交并生成评分报告。</p>
              </div>

              <div className={`rounded-[20px] border px-4 py-3 ${isOvertime ? 'border-[#efc1c8] bg-[#fff4f6]' : 'border-[#d6e2f1] bg-[#f7fbff]'}`}>
                <p className="text-[11px] text-[#6b86a4] flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5" /> {timerView.title}
                </p>
                <p className={`text-2xl font-semibold leading-tight ${isOvertime ? 'text-[#c43d4b]' : 'text-[#16355f]'}`}>{timerView.value}</p>
                <p className="text-[11px] text-[#6b86a4]">{timerView.hint}</p>
              </div>

              {!isInterviewClosed ? (
                <>
                  <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-[#16355f] flex items-center gap-1.5">
                        <ProctoringStatusIcon className="w-3.5 h-3.5" />
                        摄像头监考
                      </p>
                      <span className={`inline-flex max-w-[180px] items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${proctoringStatusClass}`}>
                        <span className="truncate">{proctoring.statusText}</span>
                      </span>
                    </div>
                    <div className="relative w-full overflow-hidden rounded-lg border border-[#c7daf6] bg-[#0f172a] aspect-video">
                      <video
                        ref={proctoring.videoRef}
                        muted
                        playsInline
                        className="h-full w-full object-fill"
                      />
                      {proctoring.faceBox ? (
                        <div
                          className={`absolute border-2 ${proctoring.faceBox.state === 'warning' ? 'border-amber-300 shadow-[0_0_0_9999px_rgba(180,83,9,0.16)]' : 'border-emerald-300 shadow-[0_0_0_9999px_rgba(16,185,129,0.08)]'}`}
                          style={{
                            left: `${proctoring.faceBox.x * 100}%`,
                            top: `${proctoring.faceBox.y * 100}%`,
                            width: `${proctoring.faceBox.width * 100}%`,
                            height: `${proctoring.faceBox.height * 100}%`,
                          }}
                        />
                      ) : proctoringRunning ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-[11px] font-semibold text-white">
                          未检测到人脸框
                        </div>
                      ) : null}
                      {proctoring.faceBox ? (
                        <div className={`absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm ${proctoring.faceBox.state === 'warning' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                          {proctoring.faceBox.label}
                        </div>
                      ) : null}
                    </div>
                    {!proctoringRunning ? (
                      <button
                        type="button"
                        onClick={() => void proctoring.start({ assumeConsent: true })}
                        disabled={proctoringRequesting}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#c7daf6] bg-white px-3 py-2 text-xs font-semibold text-[#355b87] transition-colors hover:bg-[#eef5ff] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        {proctoringRequesting ? '正在打开摄像头...' : '恢复摄像头监考'}
                      </button>
                    ) : null}
                  </div>

                  <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-[#16355f] flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        切屏监控
                      </p>
                      <span className={`inline-flex max-w-[180px] items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${screenSwitchStatusClass}`}>
                        <span className="truncate">{proctoring.screenSwitch.statusText}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-md bg-white border border-[#d6e2f1] px-2 py-1.5">
                        <p className="text-[10px] text-[#6b86a4]">已记录</p>
                        <p className="text-sm font-semibold text-[#16355f]">{proctoring.screenSwitch.eventCount}</p>
                      </div>
                      <div className="rounded-md bg-white border border-[#d6e2f1] px-2 py-1.5">
                        <p className="text-[10px] text-[#6b86a4]">累计</p>
                        <p className="text-sm font-semibold text-[#16355f]">{formatDurationMs(proctoring.screenSwitch.totalDurationMs)}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              <button
                onClick={handleRequestSubmit}
                disabled={!canFinish}
                className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-white px-4 text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                {busyAction === 'finish' ? '提交中...' : '提交'}
              </button>

              <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-3 py-3 space-y-2">
                <p className="text-xs font-semibold text-[#16355f]">本场进度</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-white border border-[#d6e2f1] px-2 py-1.5">
                    <p className="text-[10px] text-[#6b86a4]">总题目</p>
                    <p className="text-sm font-semibold text-[#16355f]">{progressTotal || '-'}</p>
                  </div>
                  <div className="rounded-md bg-white border border-[#d6e2f1] px-2 py-1.5">
                    <p className="text-[10px] text-[#6b86a4]">已完成</p>
                    <p className="text-sm font-semibold text-[#16355f]">{answeredCount}</p>
                  </div>
                  <div className="rounded-md bg-white border border-[#d6e2f1] px-2 py-1.5">
                    <p className="text-[10px] text-[#6b86a4]">完成率</p>
                    <p className="text-sm font-semibold text-[#16355f]">{completionRate}%</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>

              <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] px-3 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#6b86a4]">当前状态</span>
                  <span className="font-semibold text-[#16355f]">{roomStateLabel}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#6b86a4]">作答状态</span>
                  <span className={`font-semibold ${answerLocked ? 'text-error' : 'text-primary'}`}>
                    {answerLocked ? '已锁定' : '可继续作答'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-[#6b86a4]">提交规则</span>
                  <span className="text-right font-medium text-[#16355f]">{submissionRuleLabel}</span>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-[#6b86a4]">保存状态</span>
                  <span className="text-right font-medium text-[#16355f]">{saveStatusLabel}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {report && (
          <div className="rounded-[28px] border border-[#cddcf0] bg-white p-4 space-y-3 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
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

            {proctoringEvidence.length > 0 && (
              <div className="space-y-2">
                {proctoringEvidence.map((evidence, index) => (
                  <div key={index} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>摄像头风控复核</span>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>风险评分：{evidence.riskScore}</div>
                      <div>事件数量：{evidence.eventCount}</div>
                    </div>
                    {evidence.summary ? <p className="mt-2 whitespace-pre-wrap">{evidence.summary}</p> : null}
                    {evidence.details.some(isScreenSwitchDetail) ? (
                      <div className="mt-2 rounded border border-amber-200 bg-white/75 px-2 py-2">
                        <div className="font-semibold text-amber-950">切屏记录</div>
                        <div className="mt-1 space-y-1">
                          {evidence.details.filter(isScreenSwitchDetail).map((detail, detailIndex) => (
                            <div key={`screen-switch-detail-${detailIndex}`} className="flex flex-wrap gap-x-3 gap-y-1 text-amber-800">
                              <span>{detail.startedAt} - {detail.endedAt}</span>
                              <span>{detail.label}</span>
                              <span>持续：{formatDurationMs(detail.durationMs)}</span>
                              <span>级别：{toProctoringSeverityLabel(detail.severity)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {evidence.details.some((detail) => !isScreenSwitchDetail(detail)) ? (
                      <div className="mt-2 space-y-1.5">
                        {evidence.details.filter((detail) => !isScreenSwitchDetail(detail)).map((detail, detailIndex) => (
                          <div key={`proctoring-detail-${detailIndex}`} className="rounded border border-amber-200 bg-white/65 px-2 py-1.5">
                            <div className="font-semibold">
                              {detail.startedAt} - {detail.endedAt} · {detail.label}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-amber-800">
                              <span>级别：{toProctoringSeverityLabel(detail.severity)}</span>
                              <span>持续：{formatDurationMs(detail.durationMs)}</span>
                              {detail.faceCount !== null ? <span>人脸数：{detail.faceCount}</span> : null}
                              {detail.faceScore !== null ? <span>置信度：{Math.round(detail.faceScore * 100)}%</span> : null}
                              {detail.attentionSignal ? <span>{toProctoringAttentionLabel(detail.attentionSignal)}</span> : null}
                              {detail.poseSignal ? <span>头部信号：{toProctoringPoseLabel(detail.poseSignal)}</span> : null}
                              {detail.landmarkCount !== null ? <span>关键点：{detail.landmarkCount}</span> : null}
                              {detail.headPose.yaw !== null || detail.headPose.pitch !== null || detail.headPose.roll !== null ? (
                                <span>
                                  姿态：yaw {formatProctoringPoseValue(detail.headPose.yaw)} / pitch{' '}
                                  {formatProctoringPoseValue(detail.headPose.pitch)} / roll {formatProctoringPoseValue(detail.headPose.roll)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {evidence.snapshotPaths.length > 0 ? (
                      <p className="mt-2 text-amber-800">已保存异常关键帧 {evidence.snapshotPaths.length} 张，需在受控存储中复核。</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}




