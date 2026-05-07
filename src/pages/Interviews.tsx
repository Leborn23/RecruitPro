import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchInterviewReportByInterview, interviewRuntimeEdge, type InterviewReportRow } from '../lib/interviewRuntime';
import { getInterviewDurationMinutesForQuestionCount } from '../lib/interviewDuration';
import { DEFAULT_INTERVIEW_QUESTION_COUNT, normalizeInterviewQuestionCount } from '../lib/interviewQuestionCount';
import { removeInterviewFromLocalState } from '../lib/interviewListState';
import { normalizeReportText } from '../lib/reportText';
import { AlertTriangle, Calendar, ChevronRight, Clock, FileText, ShieldCheck, Video, Bell, X, Plus, Pencil, Trash2, HelpCircle, Maximize2, Minimize2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

type InterviewRow = {
  id: string;
  candidate_id: string | null;
  name: string;
  stage: string | null;
  position: string | null;
  schedule_time: string | null;
  interviewer: string | null;
  location_type: string | null;
  status: string | null;
  join_url: string | null;
  room_password_set_at: string | null;
  session_id: string | null;
  ai_report_id: string | null;
};

type InterviewForm = {
  candidate_id: string | null;
  name: string;
  stage: string;
  position: string;
  schedule_time: string;
  interviewer: string;
  location_type: string;
};

type CandidateOption = {
  id: string;
  name: string;
  title: string | null;
  p_id: string | null;
};

type PositionOption = {
  id: string;
  title: string;
  location: string | null;
};

type ScoreReportView = {
  id?: string;
  interview_id?: string;
  overall_score?: number | null;
  recommendation?: string | null;
  risk_score?: number | null;
  summary?: string | null;
  dimension_scores?: Record<string, number>;
  strengths?: string[];
  risks?: Array<string | Record<string, unknown>>;
  evidence?: Array<Record<string, unknown> & { turn_id?: string; turn_no?: number; excerpt?: string }>;
  question_evaluations?: Array<{
    question_index?: number;
    question: string;
    answer: string;
    feedback: string;
    missing_logic_elements: string[];
    dimensions: {
      technical_depth?: number;
      communication_logic?: number;
      problem_solving?: number;
    };
    score: number | null;
  }>;
  scoring_profile?: string;
  min_answer_required?: number;
  answered_count?: number;
  question_count?: number;
  low_quality_count?: number;
  low_quality_ratio?: number;
  hard_reject_triggered?: boolean;
  human_confirmed?: boolean;
  human_confirmed_at?: string | null;
};

type ProctoringSnapshotView = {
  path: string;
  url: string;
};

type ProctoringTimelineItem = {
  eventType: string;
  category: string;
  label: string;
  severity: string;
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
};

type SortBy = 'schedule_desc' | 'schedule_asc' | 'score_desc' | 'score_asc' | 'risk_desc' | 'updated_desc';

const PROCTORING_BUCKET = 'interview-proctoring';

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
  no_show: '候选人缺席',
  failed: '异常中断'
};

const EARLY_ENTER_MINUTES = 5;

const INSIGHT_TEXTS: Record<string, string> = {
  'Relevant role exposure in previous projects.': '过往项目经历与目标岗位有较强相关性。',
  'Can explain practical implementation details.': '能够说明方案落地过程与实现细节。',
  'Answer quality fluctuates across turns.': '不同轮次回答质量波动较大，稳定性一般。',
  'Limited evidence for deep ownership.': '主导职责与结果证明相对不足。'
};

const defaultDatetimeLocal = () =>
  new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const toDatetimeLocalValue = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return defaultDatetimeLocal();

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.includes('T') ? raw.slice(0, 16) : defaultDatetimeLocal();

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const datetimeLocalToIso = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
};

const formatScheduleDateTime = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '待定排期';

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);

  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const defaultForm = (): InterviewForm => ({
  candidate_id: null,
  name: '',
  stage: '技术初面 (算法与业务线)',
  position: '',
  schedule_time: defaultDatetimeLocal(),
  interviewer: '',
  location_type: '腾讯会议 (云端评估)'
});

const buildInterviewRoomPath = (interviewId: string) => `/interview-room/${interviewId}`;

function resolveInterviewRoomLink(interview: Pick<InterviewRow, 'id' | 'join_url'>): string {
  const preset = String(interview.join_url ?? '').trim();
  if (preset) return preset;
  if (typeof window === 'undefined') return buildInterviewRoomPath(interview.id);
  return `${window.location.origin}${buildInterviewRoomPath(interview.id)}`;
}

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

function normalizeRecommendationKey(value?: string | null): 'hire' | 'hold' | 'needs_review' | 'reject' | 'pending' {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'hire' || key === 'hold' || key === 'needs_review' || key === 'reject') return key;
  return 'pending';
}

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, minutes);
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours > 0 && mins > 0) return `${hours}小时${mins}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${mins}分钟`;
}

function buildEvidenceItems(report: ScoreReportView): string[] {
  const proctoringEvidence = (report.evidence ?? [])
    .map(formatProctoringEvidence)
    .filter(Boolean);
  const questionEvidence = (report.question_evaluations ?? []).slice(0, 3);

  if (proctoringEvidence.length > 0) {
    const questionItems = questionEvidence.slice(0, 2).map((item, index) => {
      const no = (item.question_index ?? index) + 1;
      return `第 ${no} 题：${item.question || '（无题目）'}`;
    });
    return [...proctoringEvidence, ...questionItems];
  }

  if (questionEvidence.length > 0) {
    return questionEvidence.map((item, index) => {
      const no = (item.question_index ?? index) + 1;
      return `第 ${no} 题：${item.question || '（无题目）'}`;
    });
  }

  const evidence = (report.evidence ?? [])
    .filter((item) => item.type !== 'proctoring' && item.type !== 'scoring_model')
    .slice(0, 3);
  if (evidence.length === 0) return ['暂无可展示证据片段。'];
  return evidence.map((item) => `第 ${item.turn_no ?? '-'} 轮：${String(item.excerpt ?? '').trim() || '（无文本）'}`);
}

function buildDeductionItems(report: ScoreReportView): string[] {
  const items = (report.risks ?? []).map((risk) => toInsightZh(risk)).filter(Boolean);

  if (report.hard_reject_triggered) {
    items.unshift('触发硬拒绝：低质量回答占比过高。');
  }

  if ((report.low_quality_count ?? 0) > 0) {
    const ratio = typeof report.low_quality_ratio === 'number' ? `${Math.round(report.low_quality_ratio * 100)}%` : '-';
    items.push(`低质量回答 ${report.low_quality_count} 条，占比 ${ratio}。`);
  }

  const answered = Number(report.answered_count ?? 0);
  const minRequired = Number(report.min_answer_required ?? 0);
  if (minRequired > 0 && answered < minRequired) {
    items.push(`有效回答不足：${answered}/${minRequired}，建议人工复核。`);
  }

  return items.length > 0 ? items : ['未发现明显扣分项。'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getScoringModelEvidence(report: ScoreReportView | null): Record<string, unknown> | null {
  if (!report) return null;
  return (
    report.evidence?.find((item): item is Record<string, unknown> => isRecord(item) && item.type === 'scoring_model') ??
    null
  );
}

function formatProctoringEvidence(item: unknown): string {
  if (!isRecord(item) || item.type !== 'proctoring') return '';

  const grouped = Array.isArray(item.grouped_summary) ? item.grouped_summary : [];
  const labels = grouped
    .map((entry) => {
      if (!isRecord(entry)) return '';
      const label = String(entry.label ?? '').trim();
      const count = Number(entry.count ?? 0);
      return label && count > 0 ? `${label} ${count} 次` : '';
    })
    .filter(Boolean);
  const summary = String(item.summary ?? '').trim();
  const eventCount = Number(item.event_count ?? 0);
  const riskScore = Number(item.risk_score ?? 0);

  if (labels.length > 0) {
    const suffix = riskScore > 0 ? `，监考风险 ${riskScore} 分` : '';
    return `摄像头监考：${labels.join('，')}${suffix}`;
  }

  if (summary) return `摄像头监考：${summary}`;
  if (eventCount > 0) return `摄像头监考：记录到 ${eventCount} 次异常`;
  return '';
}

function getProctoringSnapshotPaths(report: ScoreReportView | null): string[] {
  if (!report) return [];

  const paths: string[] = [];
  for (const item of report.evidence ?? []) {
    if (!isRecord(item) || item.type !== 'proctoring') continue;
    const snapshotPaths = Array.isArray(item.snapshot_paths) ? item.snapshot_paths : [];
    for (const path of snapshotPaths) {
      const normalized = String(path ?? '').trim();
      if (normalized && !paths.includes(normalized)) {
        paths.push(normalized);
      }
    }
  }

  return paths.slice(0, 12);
}

function formatReportTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '未知时间';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function toSeverityLabel(value: string): string {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  if (value === 'low') return '低';
  return value || '-';
}

function toAttentionSignalLabel(value: string): string {
  if (value === 'face_near_edge') return '人脸贴近画面边缘';
  if (value === 'face_too_small') return '人脸面积过小';
  if (value === 'face_centered') return '人脸居中';
  if (value === 'missing_face_bounds') return '缺少人脸框';
  return value;
}

function toPoseSignalLabel(value: string): string {
  if (value === 'head_turned_left') return '头部向左偏转';
  if (value === 'head_turned_right') return '头部向右偏转';
  if (value === 'head_down') return '长时间低头';
  if (value === 'head_up') return '长时间抬头';
  if (value === 'face_occluded') return '人脸关键点遮挡';
  if (value === 'head_forward') return '正对摄像头';
  return value;
}

function readNumberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatHeadPoseValue(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)}°`;
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function isScreenSwitchTimelineItem(item: ProctoringTimelineItem): boolean {
  return item.category === 'screen_switch' || item.eventType === 'page_hidden' || item.eventType === 'window_blur';
}

function getProctoringTimeline(report: ScoreReportView | null): ProctoringTimelineItem[] {
  if (!report) return [];

  const timeline: ProctoringTimelineItem[] = [];
  for (const item of report.evidence ?? []) {
    if (!isRecord(item) || item.type !== 'proctoring') continue;
    const details = Array.isArray(item.details) ? item.details : [];
    for (const detail of details) {
      if (!isRecord(detail)) continue;
      const durationMs = Number(detail.duration_ms ?? 0);
      const faceCount = detail.face_count == null ? null : Number(detail.face_count);
      const faceScore = detail.face_score == null ? null : Number(detail.face_score);
      const rawHeadPose = isRecord(detail.head_pose) ? detail.head_pose : {};
      const landmarkCount = readNumberOrNull(detail.landmark_count);
      timeline.push({
        eventType: String(detail.event_type ?? '').trim(),
        category: String(detail.category ?? '').trim(),
        label: String(detail.label ?? detail.event_type ?? '未知监考事件').trim(),
        severity: String(detail.severity ?? '').trim(),
        startedAt: formatReportTime(detail.started_at),
        endedAt: formatReportTime(detail.ended_at),
        durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        faceCount: Number.isFinite(faceCount) ? faceCount : null,
        faceScore: Number.isFinite(faceScore) ? faceScore : null,
        attentionSignal: String(detail.attention_signal ?? '').trim(),
        poseSignal: String(detail.pose_signal ?? '').trim(),
        headPose: {
          yaw: readNumberOrNull(rawHeadPose.yaw),
          pitch: readNumberOrNull(rawHeadPose.pitch),
          roll: readNumberOrNull(rawHeadPose.roll),
        },
        landmarkCount,
      });
    }
  }

  return timeline.slice(0, 20);
}

function mapReportRowToView(row: InterviewReportRow): ScoreReportView {
  const rawDimension = row.dimension_scores as Record<string, unknown> | null;
  const dimensionScores = Object.fromEntries(
    Object.entries(rawDimension ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
  );

  const strengths = Array.isArray(row.strengths)
    ? row.strengths.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const risks = Array.isArray(row.risks)
    ? row.risks
        .map((item) => (isRecord(item) ? item : String(item ?? '').trim()))
        .filter((item) => (typeof item === 'string' ? Boolean(item) : true))
    : [];
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.map((item) => {
        const data = (item ?? {}) as Record<string, unknown>;
        return {
          ...data,
          turn_id: String(data.turn_id ?? ''),
          turn_no: Number(data.turn_no ?? 0) || undefined,
          excerpt: String(data.excerpt ?? '').trim()
        };
      })
    : [];

  const questionEvaluations = Array.isArray(row.evidence)
    ? row.evidence
        .map((item, index) => {
          const data = (item ?? {}) as Record<string, unknown>;
          const question = String(data.question ?? '').trim();
          const answer = String(data.answer ?? '').trim();
          const feedback = String(data.feedback ?? '').trim();
          if (!question && !answer && !feedback) return null;

          const dimensionsRaw =
            data.dimensions && typeof data.dimensions === 'object'
              ? (data.dimensions as Record<string, unknown>)
              : {};
          const technicalDepth = Number(dimensionsRaw.technical_depth ?? 0);
          const communicationLogic = Number(dimensionsRaw.communication_logic ?? 0);
          const problemSolving = Number(dimensionsRaw.problem_solving ?? 0);
          const weightedScore =
            [technicalDepth, communicationLogic, problemSolving].every((value) => Number.isFinite(value))
              ? Math.round(technicalDepth * 5 + communicationLogic * 3 + problemSolving * 2)
              : null;

          return {
            question_index: Number(data.question_index ?? index) || index,
            question,
            answer,
            feedback,
            missing_logic_elements: Array.isArray(data.missing_logic_elements)
              ? data.missing_logic_elements.map((value) => String(value ?? '').trim()).filter(Boolean)
              : [],
            dimensions: {
              technical_depth: Number.isFinite(technicalDepth) ? technicalDepth : undefined,
              communication_logic: Number.isFinite(communicationLogic) ? communicationLogic : undefined,
              problem_solving: Number.isFinite(problemSolving) ? problemSolving : undefined
            },
            score: weightedScore
          };
        })
        .filter(Boolean) as ScoreReportView['question_evaluations']
    : [];

  return {
    id: row.id,
    interview_id: row.interview_id,
    overall_score: row.overall_score,
    recommendation: row.recommendation,
    risk_score: row.risk_score,
    summary: normalizeReportText(row.summary),
    dimension_scores: dimensionScores,
    strengths,
    risks,
    evidence,
    question_evaluations: questionEvaluations,
    human_confirmed: row.human_confirmed,
    human_confirmed_at: row.human_confirmed_at
  };
}

function toInsightZh(text: string | Record<string, unknown>): string {
  if (isRecord(text)) {
    if (text.type === 'proctoring') {
      const message = String(text.message ?? '').trim();
      if (message) return message;
      const eventCount = Number(text.event_count ?? 0);
      return eventCount > 0 ? `监考风险：记录到 ${eventCount} 次异常。` : '监考风险：记录到摄像头异常。';
    }
    return String(text.message ?? text.claim ?? '').trim();
  }

  const normalized = String(text ?? '').trim();
  if (!normalized) return '';
  if (INSIGHT_TEXTS[normalized]) return INSIGHT_TEXTS[normalized];

  const pattern = /^([a-z_]+)\s+(strong|weak)\s+\((\d{1,3})\)(?:,\s*needs human review)?$/i;
  const matched = normalized.match(pattern);
  if (matched) {
    const [, dimensionKey, level, score] = matched;
    const label = toDimensionLabel(dimensionKey);
    const levelLabel = level.toLowerCase() === 'strong' ? '表现较强' : '表现偏弱';
    const needsReview = /needs human review/i.test(normalized) ? '，建议人工复核' : '';
    return `${label}：${levelLabel}（${score}分）${needsReview}`;
  }

  return normalized
    .replace(/needs human review/gi, '建议人工复核')
    .replace(/insufficient answered turns/gi, '有效回答不足')
    .replace(/no meaningful evidence/gi, '缺少有效证据');
}

function buildReportSummaryZh(report: ScoreReportView): string {
  const structured = normalizeReportText(report.summary);
  if (structured) return structured;

  const overall = report.overall_score ?? '-';
  const risk = report.risk_score ?? '-';
  const answered = report.answered_count ?? '-';
  const total = report.question_count ?? '-';
  const minRequired = report.min_answer_required ?? '-';
  const recommendation = toRecommendationLabel(report.recommendation);
  return `综合评分 ${overall} 分，${recommendation}。风险评分 ${risk}。有效回答 ${answered}/${total}，最低有效回答要求 ${minRequired}。`;
}

function buildReportSummaryParagraphs(report: ScoreReportView): string[] {
  const summary = buildReportSummaryZh(report);
  if (!summary) return [];

  return summary
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (trimmed.length <= 120) return [trimmed];
      return trimmed
        .split(/(?<=[。；;])\s*/)
        .map((item) => item.trim())
        .filter((item) => item && !/^[;；。,\s]+$/.test(item));
    })
    .filter((item) => item && !/^[;；。,\s]+$/.test(item));
}

function extractAnsweredProgress(report: ScoreReportView | undefined): string {
  if (!report) return '-';
  const answered = Number(report.answered_count);
  const total = Number(report.question_count);
  if (Number.isFinite(answered) && Number.isFinite(total) && total > 0) {
    return `${answered}/${total}`;
  }

  const summary = String(report.summary ?? '');
  const matched = summary.match(/有效回答\s*(\d+)\s*\/?\s*(\d+)/);
  if (matched) return `${matched[1]}/${matched[2]}`;
  return '-';
}

export default function Interviews() {
  const location = useLocation();
  const navigate = useNavigate();

  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingInterviewId, setDeletingInterviewId] = useState<string | null>(null);
  const [isPrefillFlow, setIsPrefillFlow] = useState(false);
  const [returnToPath, setReturnToPath] = useState<string | null>(null);
  const [runtimeBusyInterviewId, setRuntimeBusyInterviewId] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportInterviewName, setReportInterviewName] = useState('');
  const [reportData, setReportData] = useState<ScoreReportView | null>(null);
  const [reportSnapshots, setReportSnapshots] = useState<ProctoringSnapshotView[]>([]);
  const [reportModalFullscreen, setReportModalFullscreen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [configuredQuestionCount, setConfiguredQuestionCount] = useState(DEFAULT_INTERVIEW_QUESTION_COUNT);
  const [candidateOptions, setCandidateOptions] = useState<CandidateOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<PositionOption[]>([]);
  const [reportByInterviewId, setReportByInterviewId] = useState<Record<string, ScoreReportView>>({});

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reportOnlyFilter, setReportOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('schedule_desc');

  const [form, setForm] = useState<InterviewForm>(defaultForm());
  const interviewDurationMinutes = getInterviewDurationMinutesForQuestionCount(configuredQuestionCount);
  const stageSuggestions = useMemo(
    () => Array.from(new Set(interviews.map((item) => String(item.stage ?? '').trim()).filter(Boolean))).slice(0, 8),
    [interviews]
  );
  const locationSuggestions = useMemo(
    () => Array.from(new Set(interviews.map((item) => String(item.location_type ?? '').trim()).filter(Boolean))).slice(0, 8),
    [interviews]
  );

  const syncFormWithCandidate = (candidateId: string | null, explicitPositionId?: string | null) => {
    const candidate = candidateOptions.find((item) => item.id === candidateId) ?? null;
    const resolvedPositionId = explicitPositionId ?? candidate?.p_id ?? null;
    const position = positionOptions.find((item) => item.id === resolvedPositionId) ?? null;

    setForm((prev) => ({
      ...prev,
      candidate_id: candidateId,
      name: candidate?.name ?? prev.name,
      position: position?.title ?? candidate?.title ?? prev.position,
      location_type: isRemote(prev.location_type)
        ? prev.location_type
        : position?.location?.trim()
          ? position.location
          : prev.location_type,
    }));
  };

  const getTimeRemaining = (timeStr: string | null | undefined) => {
    if (!timeStr) return null;
    const scheduledAt = new Date(timeStr).getTime();
    if (Number.isNaN(scheduledAt)) return null;

    const startDiffMin = Math.ceil((scheduledAt - clockNow) / 60000);
    if (startDiffMin > 0) {
      if (startDiffMin <= 60) {
        return {
          label: `距开始 ${formatMinutes(startDiffMin)}`,
          color: 'text-error bg-error/10 border-error/20 animate-pulse',
          pulse: true
        };
      }
      return {
        label: `距开始 ${formatMinutes(startDiffMin)}`,
        color: 'text-primary bg-primary/10 border-primary/20'
      };
    }

    const endAt = scheduledAt + interviewDurationMinutes * 60 * 1000;
    const remainingMin = Math.ceil((endAt - clockNow) / 60000);
    if (remainingMin >= 0) {
      return {
        label: `剩余 ${formatMinutes(remainingMin)}`,
        color: 'text-primary bg-primary/10 border-primary/20'
      };
    }

    const overtimeMin = Math.ceil((clockNow - endAt) / 60000);
    if (overtimeMin <= 60) {
      return {
        label: `已超时 ${formatMinutes(overtimeMin)}`,
        color: 'text-error bg-error/10 border-error/20'
      };
    }

    return null;
  };

  const getCanEnter = (timeStr: string | null | undefined) => {
    if (!timeStr) return false;
    const scheduledAt = new Date(timeStr).getTime();
    if (Number.isNaN(scheduledAt)) return false;

    const diffMin = (scheduledAt - clockNow) / 60000;
    return diffMin <= EARLY_ENTER_MINUTES && diffMin >= -interviewDurationMinutes;
  };

  const isEnded = (timeStr: string | null | undefined) => {
    if (!timeStr) return false;
    const scheduledAt = new Date(timeStr).getTime();
    if (Number.isNaN(scheduledAt)) return false;
    return clockNow > scheduledAt + interviewDurationMinutes * 60 * 1000;
  };

  const isRemote = (locationType: string | null | undefined) => {
    if (!locationType) return false;
    const l = locationType.toLowerCase();
    return l.includes('会议') || l.includes('云端') || l.includes('线上') || l.includes('白板') || l.includes('remote') || l.includes('zoom') || l.includes('meet');
  };

  const fetchReportsForInterviews = async (rows: InterviewRow[]) => {
    if (rows.length === 0) {
      setReportByInterviewId({});
      return;
    }

    const interviewIds = rows.map((row) => row.id);
    const { data, error } = await supabase
      .from('interview_reports')
      .select(
        'id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score,human_confirmed,human_confirmed_by,human_confirmed_at,generated_by,created_at,updated_at'
      )
      .in('interview_id', interviewIds)
      .order('updated_at', { ascending: false });

    if (error || !data) {
      setReportByInterviewId({});
      return;
    }

    const nextMap: Record<string, ScoreReportView> = {};
    for (const raw of data as Array<InterviewReportRow & { interview_id: string }>) {
      const interviewId = String(raw.interview_id ?? '').trim();
      if (!interviewId || nextMap[interviewId]) continue;
      nextMap[interviewId] = mapReportRowToView(raw);
    }

    setReportByInterviewId(nextMap);
  };

  const fetchInterviews = async () => {
    const { data: settingsData } = await supabase
      .from('company_settings')
      .select('interview_question_count')
      .single();
    setConfiguredQuestionCount(
      normalizeInterviewQuestionCount((settingsData as { interview_question_count?: unknown } | null)?.interview_question_count)
    );

    const { data } = await supabase.from('upcoming_interviews').select('*').order('created_at', { ascending: false });
    const rows = (data ?? []) as InterviewRow[];
    setInterviews(rows);
    await fetchReportsForInterviews(rows);
  };

  const fetchModalOptions = async () => {
    const [{ data: candidateData }, { data: positionData }] = await Promise.all([
      supabase.from('candidates').select('id,name,title,p_id').order('created_at', { ascending: false }),
      supabase.from('active_positions').select('id,title,location').order('created_at', { ascending: false }),
    ]);

    setCandidateOptions(
      ((candidateData ?? []) as Array<Record<string, unknown>>)
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          name: String(item.name ?? '').trim(),
          title: typeof item.title === 'string' ? item.title : null,
          p_id: typeof item.p_id === 'string' ? item.p_id : null,
        }))
        .filter((item) => item.id && item.name)
    );

    setPositionOptions(
      ((positionData ?? []) as Array<Record<string, unknown>>)
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          title: String(item.title ?? '').trim(),
          location: typeof item.location === 'string' ? item.location : null,
        }))
        .filter((item) => item.id && item.title)
    );
  };

  const handleOpenRoomPage = (interview: InterviewRow) => {
    navigate(buildInterviewRoomPath(interview.id));
  };

  const handleCopyRoomLink = async (interview: InterviewRow) => {
    const link = resolveInterviewRoomLink(interview);
    const { data, error } = await supabase.functions.invoke('interview-room-password', {
      body: {
        action: 'issue',
        interviewId: interview.id
      }
    });

    if (error) {
      alert(`生成考场密码失败：${toErrorMessage(error, 'unknown error')}`);
      return;
    }

    const roomPassword = String((data as { password?: unknown } | null)?.password ?? '').trim();
    if (!roomPassword) {
      alert('生成考场密码失败：未返回密码');
      return;
    }

    await fetchInterviews();
    const clipboardText = `候选人考场链接：${link}\n进入密码：${roomPassword}`;
    try {
      await navigator.clipboard.writeText(clipboardText);
      alert(`候选人考场链接与密码已复制。\n密码：${roomPassword}`);
    } catch {
      alert(`复制失败，请手动发送：\n${clipboardText}`);
    }
  };

  useEffect(() => {
    void fetchInterviews();
    void fetchModalOptions();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const closeReportModal = () => {
    setReportModalOpen(false);
    setReportInterviewName('');
    setReportData(null);
    setReportSnapshots([]);
    setReportModalFullscreen(false);
  };

  const openReportModal = (interview: InterviewRow, report: ScoreReportView) => {
    setReportInterviewName(interview.name || '候选人');
    const normalizedReport = {
      ...report,
      summary: normalizeReportText(report.summary)
    };
    setReportData(normalizedReport);
    setReportSnapshots([]);
    setReportModalFullscreen(false);
    setReportModalOpen(true);

    const paths = getProctoringSnapshotPaths(normalizedReport);
    if (paths.length > 0) {
      supabase.storage
        .from(PROCTORING_BUCKET)
        .createSignedUrls(paths, 60 * 30)
        .then(({ data, error }) => {
          if (error) {
            console.warn('生成监考关键帧访问链接失败:', error.message);
            return;
          }

          const snapshots = (data ?? [])
            .map((item, index) => ({
              path: item.path || paths[index] || '',
              url: item.signedUrl || ''
            }))
            .filter((item) => item.path && item.url);
          setReportSnapshots(snapshots);
        });
    }
  };

  const interviewsWithReport = useMemo(
    () =>
      interviews.map((interview) => ({
        interview,
        report: reportByInterviewId[interview.id]
      })),
    [interviews, reportByInterviewId]
  );

  const boardStats = useMemo(() => {
    let scheduled = 0;
    let inProgress = 0;
    let completed = 0;
    let aiPass = 0;
    let aiReject = 0;

    interviewsWithReport.forEach(({ interview, report }) => {
      const status = String(interview.status ?? '').trim().toLowerCase();
      if (status === 'in_progress') inProgress += 1;
      else if (status === 'completed') completed += 1;
      else scheduled += 1;

      const decision = normalizeRecommendationKey(report?.recommendation);
      if (decision === 'hire') aiPass += 1;
      if (decision === 'reject') aiReject += 1;
    });

    return { scheduled, inProgress, completed, aiPass, aiReject };
  }, [interviewsWithReport]);

  const heroDensityStats = useMemo(() => {
    const todayKey = new Date(clockNow).toDateString();
    let generatedReports = 0;
    let todayInterviews = 0;

    interviewsWithReport.forEach(({ interview, report }) => {
      if (report) generatedReports += 1;
      if (interview.schedule_time) {
        const schedule = new Date(interview.schedule_time);
        if (!Number.isNaN(schedule.getTime()) && schedule.toDateString() === todayKey) {
          todayInterviews += 1;
        }
      }
    });

    return {
      generatedReports,
      pendingReports: Math.max(interviewsWithReport.length - generatedReports, 0),
      todayInterviews,
    };
  }, [clockNow, interviewsWithReport]);

  const visibleInterviews = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    const filtered = interviewsWithReport.filter(({ interview, report }) => {
      const status = String(interview.status ?? '').trim().toLowerCase();

      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (reportOnlyFilter && !report) return false;

      if (!keyword) return true;

      const haystack = [
        interview.name,
        interview.position,
        interview.stage,
        toStatusLabel(interview.status),
        toRecommendationLabel(report?.recommendation)
      ]
        .map((item) => String(item ?? '').toLowerCase())
        .join(' ');

      return haystack.includes(keyword);
    });

    const sorted = filtered.slice().sort((left, right) => {
      const lInterview = left.interview;
      const rInterview = right.interview;
      const lReport = left.report;
      const rReport = right.report;

      const lSchedule = new Date(lInterview.schedule_time ?? 0).getTime() || 0;
      const rSchedule = new Date(rInterview.schedule_time ?? 0).getTime() || 0;
      const lUpdated = new Date((lInterview as { updated_at?: string }).updated_at ?? lInterview.schedule_time ?? 0).getTime() || 0;
      const rUpdated = new Date((rInterview as { updated_at?: string }).updated_at ?? rInterview.schedule_time ?? 0).getTime() || 0;
      const lScore = Number(lReport?.overall_score);
      const rScore = Number(rReport?.overall_score);
      const lRisk = Number(lReport?.risk_score);
      const rRisk = Number(rReport?.risk_score);

      if (sortBy === 'schedule_asc') return lSchedule - rSchedule;
      if (sortBy === 'schedule_desc') return rSchedule - lSchedule;
      if (sortBy === 'score_desc') return (Number.isFinite(rScore) ? rScore : -1) - (Number.isFinite(lScore) ? lScore : -1);
      if (sortBy === 'score_asc') return (Number.isFinite(lScore) ? lScore : 999) - (Number.isFinite(rScore) ? rScore : 999);
      if (sortBy === 'risk_desc') return (Number.isFinite(rRisk) ? rRisk : -1) - (Number.isFinite(lRisk) ? lRisk : -1);
      return rUpdated - lUpdated;
    });

    return sorted;
  }, [interviewsWithReport, searchText, statusFilter, reportOnlyFilter, sortBy]);

  useEffect(() => {
    if (visibleInterviews.length === 0) {
      setSelectedInterviewId(null);
      return;
    }

    if (selectedInterviewId && visibleInterviews.some(({ interview }) => interview.id === selectedInterviewId)) {
      return;
    }

    setSelectedInterviewId(visibleInterviews[0].interview.id);
  }, [visibleInterviews, selectedInterviewId]);

  useEffect(() => {
    const prefill = location.state?.prefillCandidate;
    if (!prefill) return;

    setForm({
      candidate_id: typeof prefill.id === 'string' ? prefill.id : null,
      name: prefill.name || '',
      stage: '技术初面 (算法与业务线)',
      position: prefill.title || '',
      schedule_time: defaultDatetimeLocal(),
      interviewer: '',
      location_type: '腾讯会议 (云端评估)'
    });
    setEditingId(null);
    setIsPrefillFlow(true);
    setReturnToPath(location.state?.returnTo || null);
    setIsModalOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    if (!isModalOpen || !form.candidate_id) return;
    const candidate = candidateOptions.find((item) => item.id === form.candidate_id);
    if (!candidate) return;
    const position = positionOptions.find((item) => item.id === candidate.p_id);

    setForm((prev) => ({
      ...prev,
      name: candidate.name || prev.name,
      position: position?.title ?? candidate.title ?? prev.position,
      location_type: isRemote(prev.location_type)
        ? prev.location_type
        : position?.location?.trim()
          ? position.location
          : prev.location_type,
    }));
  }, [candidateOptions, form.candidate_id, isModalOpen, positionOptions]);

  const openNewModal = () => {
    setForm(defaultForm());
    setEditingId(null);
    setIsPrefillFlow(false);
    setReturnToPath(null);
    setIsModalOpen(true);
  };

  const openEditModal = (interview: InterviewRow) => {
    setForm({
      candidate_id: interview.candidate_id,
      name: interview.name,
      stage: interview.stage || '',
      position: interview.position || '',
      schedule_time: toDatetimeLocalValue(interview.schedule_time),
      interviewer: interview.interviewer || '',
      location_type: interview.location_type || ''
    });
    setEditingId(interview.id);
    setIsPrefillFlow(false);
    setReturnToPath(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    const shouldReturn = isPrefillFlow && !editingId;
    const targetPath = returnToPath;

    setIsModalOpen(false);
    setEditingId(null);
    setIsPrefillFlow(false);
    setReturnToPath(null);

    if (shouldReturn) {
      if (targetPath) navigate(targetPath);
      else navigate(-1);
    }
  };

  const handleDeleteConfirmed = async (id: string) => {
    const previousInterviews = interviews;
    const previousReports = reportByInterviewId;
    const nextState = removeInterviewFromLocalState(previousInterviews, previousReports, id);

    setDeletingInterviewId(id);
    setConfirmDeleteId(null);
    setInterviews(nextState.rows);
    setReportByInterviewId(nextState.reportsByInterviewId);
    setSelectedInterviewId((current) => (current === id ? nextState.rows[0]?.id ?? null : current));

    const { error } = await supabase.from('upcoming_interviews').delete().eq('id', id);
    setDeletingInterviewId(null);
    if (error) {
      setInterviews(previousInterviews);
      setReportByInterviewId(previousReports);
      alert(`删除失败：${error.message}`);
    }
  };

  const handleSaveInterview = async () => {
    if (!form.candidate_id || !form.name || !form.position) return alert('请先选择候选人和岗位');

    setSaving(true);
    let apiError: { message: string } | null = null;
    const payload = {
      ...form,
      schedule_time: datetimeLocalToIso(form.schedule_time)
    };

    if (editingId) {
      const { error } = await supabase.from('upcoming_interviews').update(payload).eq('id', editingId);
      apiError = error as { message: string } | null;
    } else {
      const { error } = await supabase.from('upcoming_interviews').insert([payload]);
      apiError = error as { message: string } | null;
    }

    setSaving(false);

    if (apiError) {
      alert(`保存失败：${apiError.message}`);
      return;
    }

    setIsModalOpen(false);
    setIsPrefillFlow(false);
    setReturnToPath(null);
    await fetchInterviews();
  };

  const handleFinishAndScore = async (interview: InterviewRow) => {
    const sessionId = String(interview.session_id ?? '').trim();
    if (!sessionId) {
      alert('当前面试尚未生成 session，请先启动 AI 初面');
      return;
    }

    setRuntimeBusyInterviewId(interview.id);
    try {
      await interviewRuntimeEdge.finishInterview<any>({
        interviewId: interview.id,
        sessionId
      });

      const scored = await interviewRuntimeEdge.scoreInterview<any>({
        interviewId: interview.id,
        sessionId
      });

      await fetchInterviews();
      const report = scored?.report ? mapReportRowToView(scored.report as InterviewReportRow) : null;
        if (!report) {
          alert('评分完成，但报告内容为空');
          return;
        }

        openReportModal(interview, {
          ...report,
          interview_id: interview.id,
          human_confirmed: false,
          human_confirmed_at: null
        });
      } catch (error) {
        alert(`结束并评分失败：${toErrorMessage(error, 'unknown error')}`);
      } finally {
        setRuntimeBusyInterviewId(null);
      }
  };

    const handleOpenReport = async (interview: InterviewRow) => {
      const cached = reportByInterviewId[interview.id];
      if (cached) {
        openReportModal(interview, cached);
        return;
      }

    setRuntimeBusyInterviewId(interview.id);
    try {
      const report = await fetchInterviewReportByInterview(interview.id);
      if (!report) {
        alert('当前场次尚未生成评分报告');
        return;
      }

        const mapped = mapReportRowToView(report);
        setReportByInterviewId((prev) => ({ ...prev, [interview.id]: mapped }));
        openReportModal(interview, mapped);
      } catch (error) {
        alert(`读取评分报告失败：${toErrorMessage(error, 'unknown error')}`);
      } finally {
        setRuntimeBusyInterviewId(null);
      }
  };

  const getPrimaryAction = (interview: InterviewRow) => {
    const status = String(interview.status ?? '').trim().toLowerCase();
    const hasReport = Boolean(reportByInterviewId[interview.id]) || Boolean(interview.ai_report_id);
    const hasSession = Boolean(String(interview.session_id ?? '').trim());
    const ended = isEnded(interview.schedule_time);
    const canEnter = getCanEnter(interview.schedule_time);

    if (hasReport) {
      return {
        type: 'view_report' as const,
        label: '查看报告',
        disabled: false,
        style: 'secondary'
      };
    }

    if (status === 'in_progress') {
      return {
        type: 'finish' as const,
        label: '结束并出报告',
        disabled: false,
        style: 'danger'
      };
    }

    if (hasSession && canEnter) {
      return {
        type: 'enter' as const,
        label: '进入专属考场页',
        disabled: false,
        style: 'primary'
      };
    }

    if (ended) {
      return {
        type: 'none' as const,
        label: '面试已结束',
        disabled: true,
        style: 'muted'
      };
    }

    if (!canEnter) {
      return {
        type: 'none' as const,
        label: '未到开放时间',
        disabled: true,
        style: 'muted'
      };
    }

    return {
      type: 'enter' as const,
      label: '进入专属考场页',
      disabled: false,
      style: 'primary'
    };
  };

  const getStepStates = (interview: InterviewRow) => {
    const status = String(interview.status ?? '').trim().toLowerCase();
    const hasSession = Boolean(String(interview.session_id ?? '').trim());
    const hasReport = Boolean(interview.ai_report_id);

    const prepareDone = hasSession;
    const startDone = status === 'in_progress' || status === 'completed';
    const turnDone = status === 'completed';
    const turnActive = status === 'in_progress';
    const finishDone = status === 'completed';
    const scoreDone = hasReport;

    return [
      { key: 'prepare', label: '准备', state: prepareDone ? 'done' : 'todo' },
      { key: 'start', label: '开始', state: startDone ? 'done' : prepareDone ? 'active' : 'todo' },
      { key: 'turn', label: '问答', state: turnDone ? 'done' : turnActive ? 'active' : 'todo' },
      { key: 'finish', label: '结束', state: finishDone ? 'done' : turnActive ? 'active' : 'todo' },
      { key: 'score', label: '评分', state: scoreDone ? 'done' : finishDone ? 'active' : 'todo' }
    ] as const;
  };

  const handlePrimaryAction = async (interview: InterviewRow) => {
    const action = getPrimaryAction(interview);
    if (action.type === 'enter') {
      handleOpenRoomPage(interview);
      return;
    }
    if (action.type === 'finish') {
      await handleFinishAndScore(interview);
      return;
    }
    if (action.type === 'view_report') {
      await handleOpenReport(interview);
    }
  };

  const selectedInterviewEntry =
    visibleInterviews.find(({ interview }) => interview.id === selectedInterviewId) ?? visibleInterviews[0] ?? null;

  const selectedInterview = selectedInterviewEntry?.interview ?? null;
  const selectedReport = selectedInterviewEntry?.report;
  const selectedAction = selectedInterview ? getPrimaryAction(selectedInterview) : null;
  const selectedTimeRemaining = selectedInterview ? getTimeRemaining(selectedInterview.schedule_time) : null;
  const activeInterviewRows = interviewsWithReport
    .map(({ interview }) => interview)
    .filter((interview) => String(interview.status ?? '').trim().toLowerCase() === 'in_progress');
  const reportProctoringTimeline = getProctoringTimeline(reportData);
  const reportCameraTimeline = reportProctoringTimeline.filter((item) => !isScreenSwitchTimelineItem(item));
  const reportScreenSwitchTimeline = reportProctoringTimeline.filter(isScreenSwitchTimelineItem);
  const reportScoringModel = getScoringModelEvidence(reportData);
  const reportAbilityScore = reportScoringModel?.ability_score ?? reportData?.overall_score ?? '-';
  const reportRiskScore = reportScoringModel?.risk_score ?? reportData?.risk_score ?? '-';
  const reportDecisionReason = typeof reportScoringModel?.decision_reason === 'string' ? reportScoringModel.decision_reason : '';
  const reportSummaryParagraphs = reportData ? buildReportSummaryParagraphs(reportData) : [];
  const reportDeductionItems = reportData ? buildDeductionItems(reportData) : [];
  const reportEvidenceItems = reportData ? buildEvidenceItems(reportData) : [];
  const reportDimensionEntries = reportData ? Object.entries(reportData.dimension_scores ?? {}) : [];
  const selectedSummaryItems = selectedInterview
    ? [
        { label: '候选人', value: selectedInterview.name || '待补充' },
        { label: '岗位', value: selectedInterview.position || '未关联岗位' },
        {
          label: '排期时间',
          value: formatScheduleDateTime(selectedInterview.schedule_time)
        }
      ]
    : [];

  return (
    <div className="relative space-y-6 pb-12 animate-in fade-in duration-500">
      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-[#426a9a]">
                  <Calendar className="h-3.5 w-3.5" />
                  面试中控
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-[#16355f]">面试调度台</h1>
                  <p className="mt-1 text-sm text-[#5d7896]">先看场次状态、报告产出和当前关注对象，再决定排期与处理动作。</p>
                </div>
              </div>

              <button
                onClick={openNewModal}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#1f5fbf] px-4 py-3 text-sm font-medium text-white shadow-[0_18px_36px_-20px_rgba(31,95,191,0.9)] transition hover:bg-[#194f9e]"
              >
                <Plus className="h-4 w-4" />
                新建面试
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">待开始</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.scheduled}</p>
              </div>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">进行中</p>
                <p className="mt-2 text-3xl font-semibold text-[#1f5fbf]">{boardStats.inProgress}</p>
              </div>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">已结束</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.completed}</p>
              </div>
              <div className="rounded-[20px] border border-[#d9eddf] bg-[#f5fbf7] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#5f896c]">建议通过</p>
                <p className="mt-2 text-3xl font-semibold text-[#24623a]">{boardStats.aiPass}</p>
              </div>
              <div className="rounded-[20px] border border-[#f1d8de] bg-[#fff6f8] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d6576]">建议淘汰</p>
                <p className="mt-2 text-3xl font-semibold text-[#8e3550]">{boardStats.aiReject}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">今日排期</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{heroDensityStats.todayInterviews} 场</p>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">已出报告</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{heroDensityStats.generatedReports} 场</p>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">待评分</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{heroDensityStats.pendingReports} 场</p>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">当前筛选</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{visibleInterviews.length} 场</p>
              </div>
            </div>
          </div>

            <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6b86a4]">当前关注</p>
                <h2 className="mt-1 text-lg font-semibold text-[#16355f]">
                  {selectedInterview?.name || '暂无面试场次'}
                </h2>
              </div>
              {selectedTimeRemaining ? (
                <span className="rounded-full border border-[#d6e2f1] bg-white px-3 py-1 text-xs font-medium text-[#24476b]">
                  {selectedTimeRemaining.label}
                </span>
              ) : null}
            </div>

            {selectedInterview ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectedSummaryItems.map((item) => (
                    <div key={item.label} className="rounded-[16px] border border-[#d6e2f1] bg-white/88 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">{item.label}</p>
                      <p className="mt-1.5 text-sm font-medium text-[#24476b]">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-[16px] border border-[#d6e2f1] bg-white/88 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[#d6e2f1] bg-[#f8fbff] px-2.5 py-1 text-xs text-[#24476b]">
                      状态：{toStatusLabel(selectedInterview.status)}
                    </span>
                    <span className="rounded-full border border-[#d6e2f1] bg-[#f8fbff] px-2.5 py-1 text-xs text-[#24476b]">
                      报告：{selectedReport ? '已生成' : '未生成'}
                    </span>
                    <span className="rounded-full border border-[#d6e2f1] bg-[#f8fbff] px-2.5 py-1 text-xs text-[#24476b]">
                      AI结论：{selectedReport ? toRecommendationLabel(selectedReport.recommendation) : '待评分'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAction ? (
                      <button
                        type="button"
                        onClick={() => void handlePrimaryAction(selectedInterview)}
                        disabled={selectedAction.disabled || runtimeBusyInterviewId === selectedInterview.id}
                        className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                          selectedAction.style === 'danger'
                            ? 'bg-[#8e3550] text-white hover:bg-[#7b2d45]'
                            : selectedAction.style === 'secondary'
                              ? 'border border-[#c7daf6] bg-white text-[#1f5fbf] hover:bg-[#f4f8ff]'
                              : selectedAction.style === 'muted'
                                ? 'cursor-not-allowed bg-[#dfe8f3] text-[#6b86a4]'
                                : 'bg-[#1f5fbf] text-white hover:bg-[#194f9e]'
                        }`}
                      >
                        <ChevronRight className="h-4 w-4" />
                        {runtimeBusyInterviewId === selectedInterview.id ? '处理中...' : selectedAction.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openEditModal(selectedInterview)}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#c7daf6] bg-white px-3.5 py-2.5 text-sm font-medium text-[#24476b] transition hover:bg-[#f4f8ff]"
                    >
                      <Pencil className="h-4 w-4" />
                      编辑排期
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[18px] border border-dashed border-[#cddcf0] bg-white/70 px-4 py-10 text-center text-sm text-[#6b86a4]">
                当前没有可处理的面试场次。
              </div>
            )}
          </div>
        </div>
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-outline-variant/15 flex justify-between items-center bg-surface-container-low/50">
              <h3 className="font-semibold text-on-surface">{editingId ? '编辑面试排期' : '安排新面试'}</h3>
              <button onClick={handleCloseModal} className="text-on-surface-variant hover:text-on-surface p-1 rounded-md hover:bg-surface-container transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">候选人姓名</label>
                  <select
                    value={form.candidate_id ?? ''}
                    onChange={(e) => syncFormWithCandidate(e.target.value || null)}
                    className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all"
                  >
                    <option value="">请选择候选人</option>
                    {candidateOptions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">应聘职位</label>
                  <select
                    value={positionOptions.find((item) => item.title === form.position)?.id ?? ''}
                    onChange={(e) => syncFormWithCandidate(form.candidate_id, e.target.value || null)}
                    className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all"
                  >
                    <option value="">请选择岗位</option>
                    {positionOptions.map((position) => (
                      <option key={position.id} value={position.id}>
                        {position.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {form.candidate_id ? (
                <div className="rounded-xl border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2 text-xs text-[#5d7896]">
                  已联动候选人库与岗位库：{form.name || '未命名'} · {form.position || '未匹配岗位'}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">面试轮次</label>
                <input type="text" list="interview-stage-options" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
                <datalist id="interview-stage-options">
                  {stageSuggestions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">排期时间</label>
                <input type="datetime-local" value={form.schedule_time} onChange={(e) => setForm({ ...form, schedule_time: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all cursor-pointer" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">地点与形式</label>
                <input type="text" list="location-options" value={form.location_type} onChange={(e) => setForm({ ...form, location_type: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
                <datalist id="location-options">
                  {locationSuggestions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/15 flex justify-end gap-3 bg-surface-container-low/30">
              <button onClick={handleCloseModal} className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
                取消
              </button>
              <button onClick={handleSaveInterview} disabled={saving} className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-md shadow hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer">
                {saving ? '保存中...' : editingId ? '保存修改' : '提交入库'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportModalOpen && reportData && (
        <div className={`fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center ${reportModalFullscreen ? 'p-0' : 'p-4'}`}>
          <div className={`bg-surface-container-lowest w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col ${
            reportModalFullscreen ? 'h-screen max-h-screen rounded-none' : 'max-w-5xl max-h-[92vh] rounded-xl'
          }`}>
            <div className="px-6 py-4 border-b border-outline-variant/15 flex justify-between items-center bg-surface-container-low/50">
              <h3 className="font-semibold text-on-surface">AI 评分报告 · {reportInterviewName}</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReportModalFullscreen((current) => !current)}
                  aria-label={reportModalFullscreen ? '退出全屏' : '全屏查看'}
                  title={reportModalFullscreen ? '退出全屏' : '全屏查看'}
                  className="text-on-surface-variant hover:text-on-surface p-1 rounded-md hover:bg-surface-container transition-colors cursor-pointer"
                >
                  {reportModalFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={closeReportModal}
                  aria-label="关闭报告"
                  title="关闭报告"
                  className="text-on-surface-variant hover:text-on-surface p-1 rounded-md hover:bg-surface-container transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
              <section className="rounded-xl border border-[#cddcf0] bg-white px-5 py-4 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.24)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <h4 className="text-base font-semibold text-on-surface">综合评语</h4>
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {toRecommendationLabel(reportData.recommendation)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(reportSummaryParagraphs.length > 0 ? reportSummaryParagraphs : ['当前报告暂无综合评语。']).map((paragraph, index) => (
                        <p
                          key={`report-summary-top-${index}`}
                          className="text-sm leading-6 text-on-surface-variant whitespace-pre-wrap break-words"
                        >
                          {paragraph}
                        </p>
                      ))}
                      {reportDecisionReason && !reportSummaryParagraphs.some((paragraph) => paragraph.includes(reportDecisionReason)) ? (
                        <p className="text-sm leading-6 text-on-surface-variant whitespace-pre-wrap break-words">
                          最终建议：{reportDecisionReason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 text-xs sm:w-auto sm:min-w-[280px]">
                    <div className="rounded-lg border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2">
                      <p className="text-[#6b86a4]">能力分</p>
                      <p className="text-2xl font-bold leading-tight text-[#16355f]">{String(reportAbilityScore)}</p>
                    </div>
                    <div className="rounded-lg border border-[#efc1c8] bg-[#fff7f8] px-3 py-2">
                      <p className="text-[#8e5c66]">风险分</p>
                      <p className="text-2xl font-bold leading-tight text-[#b4233d]">{String(reportRiskScore)}</p>
                    </div>
                    <div className="rounded-lg border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2">
                      <p className="text-[#6b86a4]">有效回答</p>
                      <p className="text-base font-semibold text-[#16355f]">{extractAnsweredProgress(reportData)}</p>
                    </div>
                    <div className="rounded-lg border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2">
                      <p className="text-[#6b86a4]">监考事件</p>
                      <p className="text-base font-semibold text-[#16355f]">{reportProctoringTimeline.length}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    <h4 className="text-sm font-semibold text-on-surface">扣分原因</h4>
                  </div>
                  <div className="space-y-2">
                    {(reportDeductionItems.length > 0 ? reportDeductionItems : ['暂无明确扣分原因。']).map((line, idx) => (
                      <p key={`deduction-${idx}`} className="text-sm leading-6 text-on-surface-variant whitespace-pre-wrap break-words">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold text-on-surface">关键证据</h4>
                  </div>
                  <div className="space-y-2">
                    {reportEvidenceItems.map((line, idx) => (
                      <p key={`evidence-${idx}`} className="text-sm leading-6 text-on-surface-variant whitespace-pre-wrap break-words">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              </section>

              {reportDimensionEntries.length > 0 ? (
                <section>
                  <h4 className="text-sm font-semibold text-on-surface mb-2">维度评分</h4>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {reportDimensionEntries.map(([dimension, score]) => (
                      <div key={dimension} className="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs flex justify-between bg-surface-container-low">
                        <span className="text-on-surface-variant">{toDimensionLabel(dimension)}</span>
                        <span className="font-semibold text-on-surface">{score}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {reportSnapshots.length > 0 ? (
                <div>
                  <h4 className="text-sm font-semibold text-on-surface mb-2">监考关键帧</h4>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {reportSnapshots.map((snapshot, index) => (
                      <a
                        key={`${snapshot.path}-${index}`}
                        href={snapshot.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group overflow-hidden rounded border border-outline-variant/20 bg-surface-container-low"
                        title={snapshot.path}
                      >
                        <img
                          src={snapshot.url}
                          alt={`监考关键帧 ${index + 1}`}
                          className="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-on-surface-variant">
                          <span>关键帧 {index + 1}</span>
                          <span className="truncate">{snapshot.path.split('/').pop()}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {reportProctoringTimeline.length > 0 ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-amber-800" />
                      <h4 className="text-sm font-semibold text-amber-950">监控数据</h4>
                    </div>
                    <span className="rounded-full border border-amber-300 bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                      摄像头 {reportCameraTimeline.length} · 切屏 {reportScreenSwitchTimeline.length}
                    </span>
                  </div>

                  {reportScreenSwitchTimeline.length > 0 ? (
                    <div className="mb-4">
                      <p className="mb-2 text-xs font-semibold text-amber-950">切屏记录</p>
                      <div className="space-y-2">
                        {reportScreenSwitchTimeline.map((item, index) => (
                          <div key={`screen-switch-timeline-${index}-${item.startedAt}`} className="rounded-lg border border-amber-300 bg-white/75 px-3 py-2 text-xs text-amber-950">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold">{item.startedAt} - {item.endedAt} · {item.label}</span>
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px]">
                                {toSeverityLabel(item.severity)}
                              </span>
                            </div>
                            <p className="mt-1 text-amber-800">持续：{formatDurationMs(item.durationMs)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {reportCameraTimeline.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-amber-950">摄像头监考</p>
                      <div className="space-y-2">
                        {reportCameraTimeline.map((item, index) => (
                          <div key={`camera-timeline-${index}-${item.startedAt}`} className="rounded-lg border border-amber-200 bg-white/75 px-3 py-2 text-xs text-amber-950">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold">{item.startedAt} - {item.endedAt} · {item.label}</span>
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px]">
                                风险级别：{toSeverityLabel(item.severity)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-amber-900">
                              <span>持续：{formatDurationMs(item.durationMs)}</span>
                              {item.faceCount !== null ? <span>人脸数：{item.faceCount}</span> : null}
                              {item.faceScore !== null ? <span>置信度：{Math.round(item.faceScore * 100)}%</span> : null}
                              {item.attentionSignal ? <span>{toAttentionSignalLabel(item.attentionSignal)}</span> : null}
                              {item.poseSignal ? <span>头部信号：{toPoseSignalLabel(item.poseSignal)}</span> : null}
                              {item.landmarkCount !== null ? <span>关键点：{item.landmarkCount}</span> : null}
                              {item.headPose.yaw !== null || item.headPose.pitch !== null || item.headPose.roll !== null ? (
                                <span>
                                  姿态：yaw {formatHeadPoseValue(item.headPose.yaw)} / pitch {formatHeadPoseValue(item.headPose.pitch)} / roll{' '}
                                  {formatHeadPoseValue(item.headPose.roll)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div>
                <h4 className="text-sm font-semibold text-on-surface mb-2">逐题评分</h4>
                {reportData.question_evaluations && reportData.question_evaluations.length > 0 ? (
                  <div className="space-y-3">
                    {reportData.question_evaluations.map((item, index) => (
                      <div
                        key={`question-eval-${item.question_index ?? index}`}
                        className="rounded border border-outline-variant/20 bg-surface-container-low px-4 py-3 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-xs text-on-surface-variant">第 {(item.question_index ?? index) + 1} 题</p>
                            <p className="text-sm font-semibold text-on-surface whitespace-pre-wrap">{item.question || '（无题目）'}</p>
                          </div>
                          <div className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                            单题分数：{item.score ?? '-'}
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-2 text-xs">
                          <div className="rounded border border-outline-variant/15 bg-surface-container-lowest px-3 py-2 flex justify-between">
                            <span className="text-on-surface-variant">技术深度</span>
                            <span className="font-semibold text-on-surface">{item.dimensions.technical_depth ?? '-'}</span>
                          </div>
                          <div className="rounded border border-outline-variant/15 bg-surface-container-lowest px-3 py-2 flex justify-between">
                            <span className="text-on-surface-variant">表达逻辑</span>
                            <span className="font-semibold text-on-surface">{item.dimensions.communication_logic ?? '-'}</span>
                          </div>
                          <div className="rounded border border-outline-variant/15 bg-surface-container-lowest px-3 py-2 flex justify-between">
                            <span className="text-on-surface-variant">解决问题</span>
                            <span className="font-semibold text-on-surface">{item.dimensions.problem_solving ?? '-'}</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-on-surface">候选人回答</p>
                          <p className="text-xs text-on-surface-variant whitespace-pre-wrap leading-relaxed">
                            {item.answer || '（无回答记录）'}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-on-surface">AI 评语</p>
                          <p className="text-xs text-on-surface-variant whitespace-pre-wrap leading-relaxed">
                            {item.feedback || '（无评语）'}
                          </p>
                        </div>

                        {item.missing_logic_elements.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-on-surface">缺失点</p>
                            <div className="flex flex-wrap gap-2">
                              {item.missing_logic_elements.map((gap, gapIndex) => (
                                <span
                                  key={`question-eval-gap-${index}-${gapIndex}`}
                                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700"
                                >
                                  {gap}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-3 text-xs text-on-surface-variant">
                    当前报告尚未返回逐题评估。
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        )}

      <div className="grid items-start gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-4">
      <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#16355f]">筛选条件</h2>
              <span className="rounded-full border border-[#d6e2f1] bg-[#f8fbff] px-3 py-1 text-xs text-[#24476b]">
                {visibleInterviews.length} / {interviews.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">搜索</label>
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="候选人 / 岗位"
                  className="w-full rounded-2xl border border-[#d6e2f1] bg-[#f8fbff] px-3 py-2.5 text-sm text-[#16355f] outline-none transition focus:border-[#86aee7] focus:bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">状态</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-2xl border border-[#d6e2f1] bg-[#f8fbff] px-3 py-2.5 text-xs text-[#24476b] outline-none">
                  <option value="all">全部</option>
                  <option value="scheduled">待开始</option>
                  <option value="ready">待开始</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已结束</option>
                </select>
              </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">排序</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="w-full rounded-2xl border border-[#d6e2f1] bg-[#f8fbff] px-3 py-2.5 text-xs text-[#24476b] outline-none">
                <option value="schedule_desc">面试时间（最近优先）</option>
                <option value="schedule_asc">面试时间（最早优先）</option>
                <option value="score_desc">总分（高到低）</option>
                <option value="score_asc">总分（低到高）</option>
                <option value="risk_desc">风险（高到低）</option>
                <option value="updated_desc">更新时间（最近）</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#56718f]">
              <input type="checkbox" checked={reportOnlyFilter} onChange={(e) => setReportOnlyFilter(e.target.checked)} />
              仅看已出报告
            </label>

                  <div className="rounded-[18px] border border-[#d6e2f1] bg-[#f7fbff] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">当前结果</p>
              <p className="mt-2 text-sm font-medium text-[#24476b]">
                共匹配 <span className="font-semibold text-[#16355f]">{visibleInterviews.length}</span> 场
              </p>
            </div>
            </div>
          </section>

      <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">Interview load</p>
                <h2 className="mt-1 text-lg font-semibold text-[#16355f]">今日总人数 / 当前面试</h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-h-[88px] min-w-[100px] flex-col items-center justify-center rounded-[22px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3 text-center">
                  <p className="text-[11px] font-semibold text-[#56718f]">今日总人数</p>
                  <p className="mt-1 text-4xl font-semibold leading-none text-[#16355f]">{heroDensityStats.todayInterviews}</p>
                </div>
                <div className="flex min-h-[88px] min-w-[100px] flex-col items-center justify-center rounded-[22px] border border-[#c7daf6] bg-[#eef5ff] px-4 py-3 text-center">
                  <p className="text-[11px] font-semibold text-[#56718f]">当前面试</p>
                  <p className="mt-1 text-4xl font-semibold leading-none text-[#1f5fbf]">{boardStats.inProgress}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {activeInterviewRows.length > 0 ? (
                activeInterviewRows.slice(0, 4).map((interview) => (
                  <div key={interview.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#d6e2f1] bg-[#f8fbff] px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-semibold text-[#16355f]">{interview.name || '未命名候选人'}</span>
                    <span className="min-w-0 truncate text-[#56718f]">{interview.position || '未关联岗位'}</span>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-[#d6e2f1] px-4 py-5 text-center text-sm text-[#6b86a4]">
                  当前没有正在进行的面试。
                </div>
              )}
              {activeInterviewRows.length > 4 ? (
                <p className="text-xs text-[#6b86a4]">还有 {activeInterviewRows.length - 4} 场正在进行。</p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="space-y-4">
      <div className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#e4edf8] pb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#16355f]">排期列表</h2>
              </div>
              <button
                type="button"
                onClick={openNewModal}
                className="inline-flex items-center gap-2 rounded-xl border border-[#c7daf6] bg-[#f4f8ff] px-3.5 py-2 text-sm font-medium text-[#1f5fbf] transition hover:bg-white"
              >
                <Plus className="h-4 w-4" />
                新建
              </button>
            </div>

            <div className="mt-5 space-y-4">
          {visibleInterviews.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[#cddcf0] bg-[#f8fbff] px-6 py-14 text-center">
              <Calendar className="mx-auto h-9 w-9 text-[#89a6c7]" />
              <p className="mt-4 text-base font-medium text-[#24476b]">
                {interviews.length === 0 ? '暂无排期记录' : '当前筛选条件下没有匹配场次'}
              </p>
            </div>
          ) : (
            visibleInterviews.map(({ interview, report }, idx) => (
              <button
                key={interview.id}
                type="button"
                onClick={() => setSelectedInterviewId(interview.id)}
                className={`relative w-full overflow-hidden rounded-[24px] border p-5 text-left transition ${
                  interview.id === selectedInterview?.id
                  ? 'border-[#86aee7] bg-[#f7fbff] shadow-[0_14px_32px_-28px_rgba(21,53,102,0.18)]'
                    : idx === 0
                          ? 'border-[#f1d8de] bg-[#fffafb] shadow-[0_14px_30px_-28px_rgba(142,53,80,0.18)]'
                      : 'border-[#dde8f5] bg-white hover:border-[#aac6ea] hover:bg-[#fbfdff]'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[#16355f]">{interview.stage || '待定轮次'}</h3>
                      <span className="rounded-full border border-[#d6e2f1] bg-white px-2.5 py-1 text-[11px] text-[#24476b]">
                        {toStatusLabel(interview.status)}
                      </span>
                      {report ? (
                        <span className="rounded-full border border-[#c7daf6] bg-[#eef5ff] px-2.5 py-1 text-[11px] text-[#1f5fbf]">
                          {toRecommendationLabel(report.recommendation)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-[#24476b]">候选人：{interview.name}</p>
                    <p className="mt-2 inline-flex w-fit rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f5fbf]">
                      {interview.position || '未关联岗位'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-[#d6e2f1] bg-white px-2.5 py-1 text-[11px] text-[#56718f]">
                        总分: {report?.overall_score ?? '待评分'}
                      </span>
                      <span className="rounded-full border border-[#d6e2f1] bg-white px-2.5 py-1 text-[11px] text-[#56718f]">
                        风险: {report?.risk_score ?? '-'}
                      </span>
                      <span className="rounded-full border border-[#d6e2f1] bg-white px-2.5 py-1 text-[11px] text-[#56718f]">
                        进度: {extractAnsweredProgress(report)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {(() => {
                      const res = getTimeRemaining(interview.schedule_time);
                      if (!res) return null;
                      return (
                        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#d6e2f1] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#24476b]">
                          <Bell className={`w-3 h-3 ${res.pulse ? 'animate-bounce' : ''}`} /> {res.label}
                        </span>
                      );
                    })()}
                      <div className="flex gap-2">
                      <button
                        onClick={(event) => { event.stopPropagation(); openEditModal(interview); }}
                        disabled={deletingInterviewId === interview.id}
                        className="cursor-pointer rounded-xl p-2 text-[#56718f] transition hover:bg-white hover:text-[#1f5fbf] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {confirmDeleteId === interview.id ? (
                        <div className="flex overflow-hidden rounded-xl border border-[#f1d8de] bg-[#fff6f8]">
                          <button
                            onClick={(event) => { event.stopPropagation(); setConfirmDeleteId(null); }}
                            disabled={deletingInterviewId === interview.id}
                            className="px-2 py-1 text-xs text-[#56718f] transition hover:bg-[#fff1f4] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            取消
                          </button>
                          <button
                            onClick={(event) => { event.stopPropagation(); void handleDeleteConfirmed(interview.id); }}
                            disabled={deletingInterviewId === interview.id}
                            className="px-2 py-1 text-xs font-medium text-[#8e3550] transition hover:bg-[#ffe6ec] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingInterviewId === interview.id ? '删除中' : '确认'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(event) => { event.stopPropagation(); setConfirmDeleteId(interview.id); }}
                          disabled={deletingInterviewId === interview.id}
                          className="cursor-pointer rounded-xl p-2 text-[#56718f] transition hover:bg-[#fff1f4] hover:text-[#8e3550] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-6 border-t border-[#e4edf8] pt-4">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[#24476b]">
                    <Clock className="w-4 h-4 text-[#6b86a4]" />
                    {formatScheduleDateTime(interview.schedule_time)}
                  </div>
                  <div className={`flex items-center gap-1.5 text-sm font-medium ${isRemote(interview.location_type) ? 'text-[#1f5fbf]' : 'text-[#6b86a4]'}`}>
                    <Video className="w-4 h-4" /> {interview.location_type || '线下评估'}
                  </div>
                </div>

                <div className="mt-5">
                  {isRemote(interview.location_type) ? (
                    (() => {
                      const primaryAction = getPrimaryAction(interview);
                      const stepStates = getStepStates(interview);
                      const busy = runtimeBusyInterviewId === interview.id;
                      const canEnter = getCanEnter(interview.schedule_time);
                      const ended = isEnded(interview.schedule_time);

                      const primaryClass = primaryAction.style === 'danger'
                        ? 'bg-secondary text-white hover:bg-secondary/90'
                        : primaryAction.style === 'secondary'
                          ? 'bg-primary-container/40 text-primary border border-primary/20 hover:bg-primary-container/55'
                          : primaryAction.style === 'muted'
                            ? 'bg-surface-container-high text-on-surface-variant/70'
                            : 'bg-primary text-white hover:bg-primary/90';

                      const busyLabel = primaryAction.type === 'enter'
                        ? '启动中...'
                        : primaryAction.type === 'finish'
                          ? '处理中...'
                          : '加载中...';

                      return (
                        <div className="w-full space-y-3 rounded-[22px] border border-[#d6e2f1] bg-[#f8fbff] p-4">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handlePrimaryAction(interview);
                              }}
                              disabled={primaryAction.disabled || busy}
                              className={`cursor-pointer text-xs font-semibold h-9 px-4 rounded-md transition-colors shadow-sm inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${primaryClass}`}
                            >
                              <Video className="w-3.5 h-3.5" />
                              {busy ? busyLabel : primaryAction.label}
                            </button>
                          </div>

                          <div className="grid grid-cols-5 gap-1.5">
                            {stepStates.map((step) => (
                              <div
                                key={step.key}
                                className={`rounded-md border px-2 py-1 text-[11px] text-center font-medium ${
                                  step.state === 'done'
                                    ? 'border-[#c7daf6] bg-[#eef5ff] text-[#1f5fbf]'
                                    : step.state === 'active'
                                      ? 'border-[#f1d8de] bg-[#fff6f8] text-[#8e3550]'
                                      : 'border-[#d6e2f1] bg-white text-[#6b86a4]'
                                }`}
                              >
                                {step.label}
                              </div>
                            ))}
                          </div>

                          <div>
                            {primaryAction.type === 'view_report' ? (
                              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-[11px] text-primary/85">
                                已完成，点击主按钮查看报告
                              </span>
                            ) : ended ? (
                              <span className="inline-flex items-center rounded-md bg-surface-container-high px-2.5 py-1 text-[11px] text-on-surface-variant/80">
                                面试窗口已结束，建议人工复核本场状态
                              </span>
                            ) : !canEnter ? (
                              <span className="inline-flex items-center rounded-md bg-surface-container-high px-2.5 py-1 text-[11px] text-on-surface-variant/80">
                                开始前 5 分钟开放进入
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-[11px] text-primary/85">
                                当前可进入考场
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 pt-3 border-t border-outline-variant/15">
                            <button
                              onClick={(event) => { event.stopPropagation(); handleOpenRoomPage(interview); }}
                              className="h-8 cursor-pointer rounded-md border border-[#d6e2f1] bg-white px-3 text-xs font-medium text-[#24476b] transition hover:bg-[#f3f8ff]"
                            >
                              打开考场页
                            </button>
                            <button
                              onClick={(event) => { event.stopPropagation(); void handleCopyRoomLink(interview); }}
                              className="h-8 cursor-pointer rounded-md border border-[#d6e2f1] bg-white px-3 text-xs font-medium text-[#56718f] transition hover:bg-[#f3f8ff]"
                            >
                              复制链接+密码
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <button
                        disabled
                        className="cursor-not-allowed bg-surface-container-high text-on-surface-variant/40 text-[11px] font-bold px-4 py-2.5 rounded shadow-sm flex items-center gap-2 border border-outline-variant/10"
                      >
                        <Video className="w-3.5 h-3.5 opacity-30" /> 进入线上考场
                      </button>
                      <div className="flex items-center gap-2 text-on-surface-variant/30 text-[11px] font-bold uppercase bg-surface-container-low px-3 py-2 rounded border border-dashed border-outline-variant/20 italic">
                        <HelpCircle className="w-3.5 h-3.5" /> 非线上考核 / 线下
                      </div>
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
            </div>

          {visibleInterviews.length > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-[22px] border border-[#d6e2f1] bg-[#f8fbff] p-4 text-xs">
              <span className="font-medium text-[#56718f]">实时数据已同步到当前面试列表</span>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}
































