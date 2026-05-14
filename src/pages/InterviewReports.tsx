import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { normalizeReportText } from '../lib/reportText';
import type { InterviewRecommendation, InterviewReportRow } from '../lib/interviewRuntime';

type InterviewSummary = {
  id: string;
  name: string;
  position: string | null;
  stage: string | null;
  schedule_time: string | null;
  status: string | null;
};

type ProctoringSummary = {
  interview_id: string;
  count: number;
  highCount: number;
};

type ReportCard = {
  report: InterviewReportRow;
  interview: InterviewSummary | null;
  proctoring: ProctoringSummary;
};

type ScoreReportView = {
  id?: string;
  interview_id?: string;
  overall_score?: number | null;
  recommendation?: InterviewRecommendation | null;
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
  answered_count?: number;
  question_count?: number;
  min_answer_required?: number;
  low_quality_count?: number;
  low_quality_ratio?: number;
  hard_reject_triggered?: boolean;
  human_confirmed?: boolean;
  human_confirmed_at?: string | null;
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

type ProctoringSnapshotView = {
  path: string;
  url: string;
};

const REPORT_COLUMNS =
  'id,session_id,interview_id,candidate_id,overall_score,dimension_scores,strengths,risks,recommendation,evidence,summary,risk_score,human_confirmed,human_confirmed_by,human_confirmed_at,generated_by,created_at,updated_at';

const INTERVIEW_COLUMNS = 'id,name,position,stage,schedule_time,status';
const PROCTORING_BUCKET = 'interview-proctoring';

const DEMO_REPORTS: ReportCard[] = [
  {
    report: {
      id: 'demo-report-frontend-engineer',
      session_id: 'demo-session-frontend-engineer',
      interview_id: 'demo-interview-frontend-engineer',
      candidate_id: null,
      overall_score: 86,
      dimension_scores: {
        technical_depth: 88,
        project_evidence: 84,
        problem_solving: 90,
        communication: 82
      },
      strengths: ['能把复杂项目拆成模块说明，关键技术取舍比较清楚。', '对性能优化、接口联调和异常兜底有实际经验。'],
      risks: ['对团队协作中的灰度发布和线上回滚细节还可以继续追问。'],
      recommendation: 'hire',
      evidence: [
        {
          type: 'scoring_model',
          ability_score: 86,
          risk_score: 18,
          decision_reason: '回答完整，有项目证据，监考风险低。'
        },
        {
          question_index: 0,
          question: '请复盘一个你主导的前端性能优化项目。',
          answer: '我先用 Lighthouse 和业务埋点定位首屏耗时，随后拆包、延迟加载非首屏模块，并把关键接口做并行预取。',
          feedback: '回答有清晰的问题定位、指标口径和落地动作，能体现真实项目经验。',
          missing_logic_elements: ['线上回滚策略可以继续补充'],
          dimensions: { technical_depth: 8, communication_logic: 8, problem_solving: 9 }
        },
        {
          question_index: 1,
          question: '如果接口偶发超时，你会怎么保证用户体验？',
          answer: '会区分读写接口，读接口加缓存和重试，写接口避免重复提交，同时给出明确的失败反馈。',
          feedback: '能覆盖重试、幂等和用户反馈，方案较完整。',
          missing_logic_elements: [],
          dimensions: { technical_depth: 8, communication_logic: 8, problem_solving: 8 }
        }
      ],
      summary:
        '候选人整体表现较强，能围绕项目目标、架构拆分、性能优化和异常处理给出完整回答。技术细节有证据支撑，沟通表达稳定，建议进入下一轮或发起录用复核。',
      risk_score: 18,
      human_confirmed: false,
      human_confirmed_by: null,
      human_confirmed_at: null,
      generated_by: 'demo',
      created_at: '2026-05-07T10:18:00+08:00',
      updated_at: '2026-05-07T10:18:00+08:00'
    },
    interview: {
      id: 'demo-interview-frontend-engineer',
      name: '陈思远',
      position: '前端工程师',
      stage: '技术初面',
      schedule_time: '2026-05-07T09:30:00+08:00',
      status: 'completed'
    },
    proctoring: { interview_id: 'demo-interview-frontend-engineer', count: 1, highCount: 0 }
  },
  {
    report: {
      id: 'demo-report-ml-engineer',
      session_id: 'demo-session-ml-engineer',
      interview_id: 'demo-interview-ml-engineer',
      candidate_id: null,
      overall_score: 62,
      dimension_scores: {
        technical_depth: 65,
        project_evidence: 58,
        problem_solving: 66,
        communication: 61
      },
      strengths: ['能说出模型训练和评估的基本流程。'],
      risks: ['关键指标解释不充分，实验设计缺少对照组。', '回答过程中出现多次离开考试页面和摄像头异常。'],
      recommendation: 'needs_review',
      evidence: [
        {
          type: 'proctoring',
          event_count: 7,
          risk_score: 78,
          summary: '记录到多次切屏和摄像头异常。',
          grouped_summary: [
            { label: '离开考试页面', count: 3 },
            { label: '人脸不完整或离开画面', count: 4 }
          ],
          details: [
            {
              event_type: 'page_hidden',
              category: 'screen_switch',
              label: '离开考试页面',
              severity: 'high',
              started_at: '2026-05-07T10:55:10+08:00',
              ended_at: '2026-05-07T10:55:39+08:00',
              duration_ms: 29000
            },
            {
              event_type: 'no_face',
              category: 'camera',
              label: '未检测到人脸',
              severity: 'medium',
              started_at: '2026-05-07T10:58:04+08:00',
              ended_at: '2026-05-07T10:58:09+08:00',
              duration_ms: 5000,
              face_count: 0,
              landmark_count: 0
            }
          ]
        },
        {
          type: 'scoring_model',
          ability_score: 62,
          risk_score: 78,
          decision_reason: '能力证据一般，监考风险较高，需要人工复核。'
        },
        {
          question_index: 0,
          question: '请说明你如何评估一个机器学习模型是否值得上线。',
          answer: '我会看准确率、召回率，然后观察线上表现。',
          feedback: '回答覆盖了基础指标，但缺少离线/在线评估、业务指标、灰度实验和回滚设计。',
          missing_logic_elements: ['离线验证集划分', 'A/B 实验', '线上监控和回滚'],
          dimensions: { technical_depth: 6, communication_logic: 6, problem_solving: 6 }
        }
      ],
      summary:
        '候选人对机器学习项目流程有基础理解，但关键实验设计、指标选择和工程落地说明不够充分。监考侧记录到多次切屏和人脸异常，建议人工复核后再决定是否进入下一轮。',
      risk_score: 78,
      human_confirmed: false,
      human_confirmed_by: null,
      human_confirmed_at: null,
      generated_by: 'demo',
      created_at: '2026-05-07T11:42:00+08:00',
      updated_at: '2026-05-07T11:42:00+08:00'
    },
    interview: {
      id: 'demo-interview-ml-engineer',
      name: '林嘉怡',
      position: '机器学习算法工程师',
      stage: '技术复面',
      schedule_time: '2026-05-07T10:45:00+08:00',
      status: 'completed'
    },
    proctoring: { interview_id: 'demo-interview-ml-engineer', count: 7, highCount: 2 }
  }
];

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
  communication_logic: '表达逻辑',
  ownership: '主导力'
};

const RECOMMENDATION_STYLES: Record<string, string> = {
  hire: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  hold: 'border-sky-200 bg-sky-50 text-sky-700',
  needs_review: 'border-amber-200 bg-amber-50 text-amber-700',
  reject: 'border-rose-200 bg-rose-50 text-rose-700'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '未记录';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatReportTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '未知时间';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toRecommendationLabel(value?: string | null): string {
  return RECOMMENDATION_LABELS[String(value ?? '').trim()] ?? '建议复核';
}

function toRecommendationStyle(value?: string | null): string {
  return RECOMMENDATION_STYLES[String(value ?? '').trim()] ?? RECOMMENDATION_STYLES.needs_review;
}

function toDimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key;
}

function formatScore(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '-';
}

function calcAverage(items: Array<number | null | undefined>): number | null {
  const valid = items.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, item) => sum + item, 0) / valid.length);
}

function readNumberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
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

function formatHeadPoseValue(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)}°`;
}

function mapReportRowToView(row: InterviewReportRow): ScoreReportView {
  const rawDimension = row.dimension_scores as Record<string, unknown> | null;
  const dimensionScores = Object.fromEntries(
    Object.entries(rawDimension ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
  );

  const strengths = Array.isArray(row.strengths) ? row.strengths.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
  const risks = Array.isArray(row.risks)
    ? row.risks.map((item) => (isRecord(item) ? item : String(item ?? '').trim())).filter((item) => (typeof item === 'string' ? Boolean(item) : true))
    : [];
  const evidence: ScoreReportView['evidence'] = Array.isArray(row.evidence)
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

  const questionEvaluations = evidence
    .map((data, index) => {
      const question = String(data.question ?? '').trim();
      const answer = String(data.answer ?? '').trim();
      const feedback = String(data.feedback ?? '').trim();
      if (!question && !answer && !feedback) return null;
      const dimensionsRaw = isRecord(data.dimensions) ? data.dimensions : {};
      const technicalDepth = Number(dimensionsRaw.technical_depth ?? 0);
      const communicationLogic = Number(dimensionsRaw.communication_logic ?? 0);
      const problemSolving = Number(dimensionsRaw.problem_solving ?? 0);
      const weightedScore = [technicalDepth, communicationLogic, problemSolving].every((value) => Number.isFinite(value))
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
    .filter(Boolean) as ScoreReportView['question_evaluations'];

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

function getScoringModelEvidence(report: ScoreReportView | null): Record<string, unknown> | null {
  if (!report) return null;
  return report.evidence?.find((item): item is Record<string, unknown> => isRecord(item) && item.type === 'scoring_model') ?? null;
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
  if (labels.length > 0) return `摄像头监考：${labels.join('，')}${riskScore > 0 ? `，监考风险 ${riskScore} 分` : ''}`;
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
      if (normalized && !paths.includes(normalized)) paths.push(normalized);
    }
  }
  return paths.slice(0, 12);
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
          roll: readNumberOrNull(rawHeadPose.roll)
        },
        landmarkCount: readNumberOrNull(detail.landmark_count)
      });
    }
  }
  return timeline.slice(0, 20);
}

function isScreenSwitchTimelineItem(item: ProctoringTimelineItem): boolean {
  return item.category === 'screen_switch' || item.eventType === 'page_hidden' || item.eventType === 'window_blur';
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
  return String(text ?? '').trim();
}

function buildReportSummaryZh(report: ScoreReportView): string {
  const structured = normalizeReportText(report.summary);
  if (structured) return structured;
  return `综合评分 ${formatScore(report.overall_score)} 分，${toRecommendationLabel(report.recommendation)}。风险评分 ${formatScore(report.risk_score)}。`;
}

function buildReportSummaryParagraphs(report: ScoreReportView): string[] {
  return buildReportSummaryZh(report)
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (trimmed.length <= 120) return [trimmed];
      return trimmed.split(/(?<=[。；;])\s*/).map((item) => item.trim()).filter(Boolean);
    });
}

function buildDeductionItems(report: ScoreReportView): string[] {
  const items = (report.risks ?? []).map((risk) => toInsightZh(risk)).filter(Boolean);
  if (report.hard_reject_triggered) items.unshift('触发硬拒绝：低质量回答占比过高。');
  if ((report.low_quality_count ?? 0) > 0) {
    const ratio = typeof report.low_quality_ratio === 'number' ? `${Math.round(report.low_quality_ratio * 100)}%` : '-';
    items.push(`低质量回答 ${report.low_quality_count} 条，占比 ${ratio}。`);
  }
  return items.length > 0 ? items : ['未发现明显扣分项。'];
}

function buildEvidenceItems(report: ScoreReportView): string[] {
  const proctoringEvidence = (report.evidence ?? []).map(formatProctoringEvidence).filter(Boolean);
  const questionEvidence = (report.question_evaluations ?? []).slice(0, 3);
  if (proctoringEvidence.length > 0) {
    return [
      ...proctoringEvidence,
      ...questionEvidence.slice(0, 2).map((item, index) => `第 ${(item.question_index ?? index) + 1} 题：${item.question || '（无题目）'}`)
    ];
  }
  if (questionEvidence.length > 0) {
    return questionEvidence.map((item, index) => `第 ${(item.question_index ?? index) + 1} 题：${item.question || '（无题目）'}`);
  }
  const evidence = (report.evidence ?? []).filter((item) => item.type !== 'proctoring' && item.type !== 'scoring_model').slice(0, 3);
  if (evidence.length === 0) return ['暂无可展示证据片段。'];
  return evidence.map((item) => `第 ${item.turn_no ?? '-'} 轮：${String(item.excerpt ?? '').trim() || '（无文本）'}`);
}

function extractAnsweredProgress(report: ScoreReportView | undefined): string {
  if (!report) return '-';
  const answered = Number(report.answered_count);
  const total = Number(report.question_count);
  if (Number.isFinite(answered) && Number.isFinite(total) && total > 0) return `${answered}/${total}`;
  return report.question_evaluations?.length ? `${report.question_evaluations.length} 题` : '-';
}

function getRiskTags(report: InterviewReportRow, proctoring: ProctoringSummary): string[] {
  const tags: string[] = [];
  if (Number(report.risk_score ?? 0) >= 70) tags.push('高风险');
  if (proctoring.count > 0) tags.push(`监考异常 ${proctoring.count}`);
  if (proctoring.highCount > 0) tags.push(`高危异常 ${proctoring.highCount}`);
  if (report.human_confirmed) tags.push('已人工确认');
  return tags;
}

function getReportSummary(report: InterviewReportRow): string {
  return buildReportSummaryZh(mapReportRowToView(report));
}

export default function InterviewReports() {
  const [reports, setReports] = useState<ReportCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [recommendationFilter, setRecommendationFilter] = useState('all');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [hiddenDemoReportIds, setHiddenDemoReportIds] = useState<string[]>([]);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [reportSnapshots, setReportSnapshots] = useState<ProctoringSnapshotView[]>([]);

  const sourceReports = useMemo(
    () => (import.meta.env.DEV ? [...DEMO_REPORTS.filter(({ report }) => !hiddenDemoReportIds.includes(report.id)), ...reports] : reports),
    [hiddenDemoReportIds, reports]
  );

  const loadReports = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: reportRows, error: reportError } = await supabase
        .from('interview_reports')
        .select(REPORT_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(100);
      if (reportError) throw reportError;

      const normalizedReports = ((reportRows ?? []) as InterviewReportRow[]).filter((report) => report.interview_id);
      const interviewIds = Array.from(new Set(normalizedReports.map((report) => report.interview_id)));
      let interviewMap = new Map<string, InterviewSummary>();
      let proctoringMap = new Map<string, ProctoringSummary>();

      if (interviewIds.length > 0) {
        const { data: interviews, error: interviewError } = await supabase
          .from('upcoming_interviews')
          .select(INTERVIEW_COLUMNS)
          .in('id', interviewIds);
        if (interviewError) throw interviewError;
        interviewMap = new Map(((interviews ?? []) as InterviewSummary[]).map((interview) => [interview.id, interview]));

        const { data: proctoringEvents, error: proctoringError } = await supabase
          .from('interview_proctoring_events')
          .select('interview_id,severity')
          .in('interview_id', interviewIds);
        if (proctoringError) throw proctoringError;

        for (const event of (proctoringEvents ?? []) as Array<{ interview_id: string; severity: string | null }>) {
          const current = proctoringMap.get(event.interview_id) ?? { interview_id: event.interview_id, count: 0, highCount: 0 };
          current.count += 1;
          if (event.severity === 'high') current.highCount += 1;
          proctoringMap.set(event.interview_id, current);
        }
      }

      setReports(
        normalizedReports.map((report) => ({
          report,
          interview: interviewMap.get(report.interview_id) ?? null,
          proctoring: proctoringMap.get(report.interview_id) ?? { interview_id: report.interview_id, count: 0, highCount: 0 }
        }))
      );
    } catch (loadError) {
      setError(toErrorMessage(loadError, '加载面试报告失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  const filteredReports = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return sourceReports.filter(({ report, interview }) => {
      if (recommendationFilter !== 'all' && report.recommendation !== recommendationFilter) return false;
      if (!keyword) return true;
      return [interview?.name, interview?.position, interview?.stage, report.summary]
        .map((item) => String(item ?? '').toLowerCase())
        .join(' ')
        .includes(keyword);
    });
  }, [recommendationFilter, searchText, sourceReports]);

  const stats = useMemo(() => {
    const hireCount = sourceReports.filter(({ report }) => report.recommendation === 'hire').length;
    const reviewCount = sourceReports.filter(({ report }) => report.recommendation === 'needs_review').length;
    const highRiskCount = sourceReports.filter(({ report, proctoring }) => Number(report.risk_score ?? 0) >= 70 || proctoring.highCount > 0).length;
    return {
      total: sourceReports.length,
      hireCount,
      reviewCount,
      highRiskCount,
      averageScore: calcAverage(sourceReports.map(({ report }) => report.overall_score)),
      averageRisk: calcAverage(sourceReports.map(({ report }) => report.risk_score))
    };
  }, [sourceReports]);

  const selectedReport = sourceReports.find(({ report }) => report.id === selectedReportId) ?? null;
  const selectedReportView = selectedReport ? mapReportRowToView(selectedReport.report) : null;
  const reportProctoringTimeline = getProctoringTimeline(selectedReportView);
  const reportCameraTimeline = reportProctoringTimeline.filter((item) => !isScreenSwitchTimelineItem(item));
  const reportScreenSwitchTimeline = reportProctoringTimeline.filter(isScreenSwitchTimelineItem);
  const reportScoringModel = getScoringModelEvidence(selectedReportView);
  const reportAbilityScore = reportScoringModel?.ability_score ?? selectedReportView?.overall_score ?? '-';
  const reportRiskScore = reportScoringModel?.risk_score ?? selectedReportView?.risk_score ?? '-';
  const reportDecisionReason = typeof reportScoringModel?.decision_reason === 'string' ? reportScoringModel.decision_reason : '';
  const reportSummaryParagraphs = selectedReportView ? buildReportSummaryParagraphs(selectedReportView) : [];
  const reportDeductionItems = selectedReportView ? buildDeductionItems(selectedReportView) : [];
  const reportEvidenceItems = selectedReportView ? buildEvidenceItems(selectedReportView) : [];
  const reportDimensionEntries = selectedReportView ? Object.entries(selectedReportView.dimension_scores ?? {}) : [];

  useEffect(() => {
    setReportSnapshots([]);
    const paths = getProctoringSnapshotPaths(selectedReportView);
    if (paths.length === 0) return;
    let cancelled = false;
    supabase.storage
      .from(PROCTORING_BUCKET)
      .createSignedUrls(paths, 60 * 30)
      .then(({ data, error: snapshotError }) => {
        if (cancelled) return;
        if (snapshotError) {
          console.warn('生成监考关键帧访问链接失败:', snapshotError.message);
          return;
        }
        setReportSnapshots(
          (data ?? [])
            .map((item, index) => ({ path: paths[index], url: item.signedUrl }))
            .filter((item) => Boolean(item.url))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selectedReportView?.id]);

  const deleteReport = async (target: ReportCard) => {
    const reportId = target.report.id;
    const candidateName = target.interview?.name ?? '该候选人';
    const confirmed = window.confirm(`确定删除 ${candidateName} 的面试报告吗？删除后列表中将不再显示这份报告。`);
    if (!confirmed) return;
    setDeletingReportId(reportId);
    setError('');
    try {
      if (String(reportId).startsWith('demo-')) {
        setHiddenDemoReportIds((current) => (current.includes(reportId) ? current : [...current, reportId]));
      } else {
        const { error: deleteError } = await supabase.from('interview_reports').delete().eq('id', reportId);
        if (deleteError) throw deleteError;
        setReports((current) => current.filter(({ report }) => report.id !== reportId));
      }
      if (selectedReportId === reportId) setSelectedReportId(null);
    } catch (deleteError) {
      setError(toErrorMessage(deleteError, '删除面试报告失败'));
    } finally {
      setDeletingReportId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-[28px] border border-[#c7dbf5] bg-white px-7 py-6 shadow-[0_18px_50px_-36px_rgba(31,95,191,0.55)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#5d789b]">Interview Reports</p>
            <h1 className="mt-2 text-3xl font-bold text-[#0b2b55]">面试报告汇总</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5d789b]">
              集中查看已经生成的 AI 评分报告、能力分、风险分和监考异常，方便后续复核与横向比较。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-[#b9d2f2] bg-[#f6faff] px-4 py-2 text-sm font-semibold text-[#1f5fbf] transition hover:border-[#1f5fbf] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="h-5 w-5" />
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: '已生成报告', value: stats.total, hint: '全部可复核报告', icon: FileText },
          { label: '建议通过', value: stats.hireCount, hint: 'AI 初步通过', icon: CheckCircle2 },
          { label: '建议复核', value: stats.reviewCount, hint: '需要人工看证据', icon: UserRound },
          { label: '平均能力分', value: formatScore(stats.averageScore), hint: '不含风险扣分', icon: FileText },
          { label: '高风险报告', value: stats.highRiskCount, hint: `平均风险 ${formatScore(stats.averageRisk)}`, icon: ShieldAlert }
        ].map(({ label, value, hint, icon: Icon }) => (
          <div key={label} className="rounded-3xl border border-[#c7dbf5] bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#6b86a4]">{label}</p>
                <p className="mt-2 text-3xl font-bold leading-none text-[#0b2b55]">{value}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eaf3ff] text-[#1f5fbf]">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs text-[#6b86a4]">{hint}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[28px] border border-[#c7dbf5] bg-white p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-2xl border border-[#c7dbf5] bg-[#f8fbff] px-4 py-3 text-sm text-[#5d789b]">
            <Search className="h-4 w-4" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索候选人 / 岗位 / 摘要"
              className="w-full bg-transparent font-medium text-[#0b2b55] outline-none placeholder:text-[#8da5c4]"
            />
          </label>
          <select
            value={recommendationFilter}
            onChange={(event) => setRecommendationFilter(event.target.value)}
            className="rounded-2xl border border-[#c7dbf5] bg-[#f8fbff] px-4 py-3 text-sm font-semibold text-[#0b2b55] outline-none"
          >
            <option value="all">全部结论</option>
            <option value="hire">建议通过</option>
            <option value="hold">建议保留</option>
            <option value="needs_review">建议复核</option>
            <option value="reject">建议淘汰</option>
          </select>
          <div className="rounded-2xl border border-[#c7dbf5] bg-[#f8fbff] px-4 py-3 text-sm font-semibold text-[#5d789b]">
            当前显示 <span className="text-[#0b2b55]">{filteredReports.length}</span> 份
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-dashed border-[#c7dbf5] bg-[#f8fbff] px-6 py-14 text-center text-sm font-semibold text-[#5d789b]">
            正在加载报告...
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#c7dbf5] bg-[#f8fbff] px-6 py-14 text-center text-sm font-semibold text-[#5d789b]">
            暂无匹配的面试报告。
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredReports.map(({ report, interview, proctoring }) => {
              const riskTags = getRiskTags(report, proctoring);
              const reportCard = { report, interview, proctoring };
              return (
                <article key={report.id} className="rounded-3xl border border-[#c7dbf5] bg-[#fbfdff] p-5 transition hover:border-[#1f5fbf] hover:bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold text-[#0b2b55]">{interview?.name ?? '未知候选人'}</h2>
                        {String(report.id).startsWith('demo-') ? (
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                            演示报告
                          </span>
                        ) : null}
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toRecommendationStyle(report.recommendation)}`}>
                          {toRecommendationLabel(report.recommendation)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#5d789b]">
                        {interview?.position ?? '未记录岗位'} · {interview?.stage ?? '未记录轮次'}
                      </p>
                      <p className="mt-1 text-xs text-[#7c93b2]">
                        报告生成：{formatDateTime(report.created_at)} · 面试时间：{formatDateTime(interview?.schedule_time)}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="min-w-20 rounded-2xl border border-[#c7dbf5] bg-white px-4 py-3">
                        <p className="text-xs text-[#6b86a4]">能力分</p>
                        <p className="mt-1 text-2xl font-bold text-[#0b2b55]">{formatScore(report.overall_score)}</p>
                      </div>
                      <div className="min-w-20 rounded-2xl border border-[#c7dbf5] bg-white px-4 py-3">
                        <p className="text-xs text-[#6b86a4]">风险分</p>
                        <p className="mt-1 text-2xl font-bold text-[#b45309]">{formatScore(report.risk_score)}</p>
                      </div>
                      <div className="min-w-20 rounded-2xl border border-[#c7dbf5] bg-white px-4 py-3">
                        <p className="text-xs text-[#6b86a4]">异常</p>
                        <p className="mt-1 text-2xl font-bold text-[#0b2b55]">{proctoring.count}</p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 line-clamp-2 text-sm leading-6 text-[#2f4c70]">{getReportSummary(report)}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {riskTags.length > 0 ? (
                        riskTags.map((tag) => (
                          <span key={tag} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          暂无明显监考风险
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedReportId(report.id)}
                        className="rounded-2xl bg-[#0b63ce] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#084fa8]"
                      >
                        查看完整报告
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteReport(reportCard)}
                        disabled={deletingReportId === report.id}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingReportId === report.id ? '删除中...' : '删除'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedReport && selectedReportView ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setSelectedReportId(null)}>
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#d8e4f4] bg-[#f7fbff] px-6 py-4">
              <h3 className="font-semibold text-[#16355f]">AI 评分报告 · {selectedReport.interview?.name ?? '未知候选人'}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedReportId(null)}
                  aria-label="关闭报告"
                  className="rounded-md p-2 text-[#6b86a4] transition hover:bg-white hover:text-[#16355f]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              <section className="rounded-xl border border-[#cddcf0] bg-white px-5 py-4 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.24)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-[#1f5fbf]" />
                      <h4 className="text-base font-semibold text-[#16355f]">综合评语</h4>
                      <span className="rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-2.5 py-0.5 text-xs font-semibold text-[#1f5fbf]">
                        {toRecommendationLabel(selectedReportView.recommendation)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(reportSummaryParagraphs.length > 0 ? reportSummaryParagraphs : ['当前报告暂无综合评语。']).map((paragraph, index) => (
                        <p key={`report-summary-top-${index}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-[#4c647f]">
                          {paragraph}
                        </p>
                      ))}
                      {reportDecisionReason && !reportSummaryParagraphs.some((paragraph) => paragraph.includes(reportDecisionReason)) ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#4c647f]">最终建议：{reportDecisionReason}</p>
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
                      <p className="text-base font-semibold text-[#16355f]">{extractAnsweredProgress(selectedReportView)}</p>
                    </div>
                    <div className="rounded-lg border border-[#d6e2f1] bg-[#f7fbff] px-3 py-2">
                      <p className="text-[#6b86a4]">监考事件</p>
                      <p className="text-base font-semibold text-[#16355f]">{reportProctoringTimeline.length}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-xl border border-[#d8e4f4] bg-[#f7fbff] px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                    <h4 className="text-sm font-semibold text-[#16355f]">扣分原因</h4>
                  </div>
                  <div className="space-y-2">
                    {reportDeductionItems.map((line, idx) => (
                      <p key={`deduction-${idx}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-[#4c647f]">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[#d8e4f4] bg-[#f7fbff] px-4 py-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[#1f5fbf]" />
                    <h4 className="text-sm font-semibold text-[#16355f]">关键证据</h4>
                  </div>
                  <div className="space-y-2">
                    {reportEvidenceItems.map((line, idx) => (
                      <p key={`evidence-${idx}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-[#4c647f]">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              </section>

              {reportDimensionEntries.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-[#16355f]">维度评分</h4>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {reportDimensionEntries.map(([dimension, score]) => (
                      <div key={dimension} className="flex justify-between rounded-lg border border-[#d8e4f4] bg-[#f7fbff] px-3 py-2 text-xs">
                        <span className="text-[#5d7896]">{toDimensionLabel(dimension)}</span>
                        <span className="font-semibold text-[#16355f]">{score}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {reportSnapshots.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-[#16355f]">监考关键帧</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {reportSnapshots.map((snapshot, index) => (
                      <a key={`${snapshot.path}-${index}`} href={snapshot.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded border border-[#d8e4f4] bg-[#f7fbff]" title={snapshot.path}>
                        <img src={snapshot.url} alt={`监考关键帧 ${index + 1}`} className="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" loading="lazy" />
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-[#5d7896]">
                          <span>关键帧 {index + 1}</span>
                          <span className="truncate">{snapshot.path.split('/').pop()}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </section>
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
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px]">{toSeverityLabel(item.severity)}</span>
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
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px]">风险级别：{toSeverityLabel(item.severity)}</span>
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
                                  姿态：yaw {formatHeadPoseValue(item.headPose.yaw)} / pitch {formatHeadPoseValue(item.headPose.pitch)} / roll {formatHeadPoseValue(item.headPose.roll)}
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

              <section>
                <h4 className="mb-2 text-sm font-semibold text-[#16355f]">逐题评分</h4>
                {selectedReportView.question_evaluations && selectedReportView.question_evaluations.length > 0 ? (
                  <div className="space-y-3">
                    {selectedReportView.question_evaluations.map((item, index) => (
                      <div key={`question-eval-${item.question_index ?? index}`} className="space-y-3 rounded border border-[#d8e4f4] bg-[#f7fbff] px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-xs text-[#6b86a4]">第 {(item.question_index ?? index) + 1} 题</p>
                            <p className="whitespace-pre-wrap text-sm font-semibold text-[#16355f]">{item.question || '（无题目）'}</p>
                          </div>
                          <div className="rounded-md border border-[#c7daf6] bg-[#f4f8ff] px-2.5 py-1 text-xs font-semibold text-[#1f5fbf]">
                            单题分数：{item.score ?? '-'}
                          </div>
                        </div>

                        <div className="grid gap-2 text-xs sm:grid-cols-3">
                          <div className="flex justify-between rounded border border-[#d8e4f4] bg-white px-3 py-2">
                            <span className="text-[#5d7896]">技术深度</span>
                            <span className="font-semibold text-[#16355f]">{item.dimensions.technical_depth ?? '-'}</span>
                          </div>
                          <div className="flex justify-between rounded border border-[#d8e4f4] bg-white px-3 py-2">
                            <span className="text-[#5d7896]">表达逻辑</span>
                            <span className="font-semibold text-[#16355f]">{item.dimensions.communication_logic ?? '-'}</span>
                          </div>
                          <div className="flex justify-between rounded border border-[#d8e4f4] bg-white px-3 py-2">
                            <span className="text-[#5d7896]">解决问题</span>
                            <span className="font-semibold text-[#16355f]">{item.dimensions.problem_solving ?? '-'}</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-[#16355f]">候选人回答</p>
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#5d7896]">{item.answer || '（无回答记录）'}</p>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-[#16355f]">AI 评语</p>
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#5d7896]">{item.feedback || '（无评语）'}</p>
                        </div>

                        {item.missing_logic_elements.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-[#16355f]">缺失点</p>
                            <div className="flex flex-wrap gap-2">
                              {item.missing_logic_elements.map((gap, gapIndex) => (
                                <span key={`question-eval-gap-${index}-${gapIndex}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
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
                  <div className="rounded border border-[#d8e4f4] bg-[#f7fbff] px-3 py-3 text-xs text-[#5d7896]">当前报告尚未返回逐题评估。</div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
