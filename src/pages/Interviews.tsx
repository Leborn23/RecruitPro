import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchInterviewReportByInterview, interviewRuntimeEdge, type InterviewReportRow } from '../lib/interviewRuntime';
import { Calendar, Clock, Video, Bell, X, Plus, Pencil, Trash2, HelpCircle } from 'lucide-react';
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

type ScoreReportView = {
  id?: string;
  interview_id?: string;
  overall_score?: number | null;
  recommendation?: string | null;
  risk_score?: number | null;
  summary?: string | null;
  dimension_scores?: Record<string, number>;
  strengths?: string[];
  risks?: string[];
  evidence?: Array<{ turn_id?: string; turn_no?: number; excerpt?: string }>;
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

type RecommendationFilter = 'all' | 'hire' | 'hold' | 'needs_review' | 'reject' | 'pending';
type ScoreBand = 'all' | 'lt60' | '60to79' | '80plus';
type RiskBand = 'all' | 'low' | 'medium' | 'high';
type SortBy = 'schedule_desc' | 'schedule_asc' | 'score_desc' | 'score_asc' | 'risk_desc' | 'updated_desc';

const RECOMMENDATION_LABELS: Record<string, string> = {
  hire: '建议通过',
  hold: '建议保留',
  needs_review: '建议复核',
  reject: '建议淘汰'
};

const SCORING_PROFILE_LABELS: Record<string, string> = {
  general: '通用模板',
  technical: '技术岗模板',
  business: '业务岗模板',
  leadership: '管理岗模板'
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

const INTERVIEW_DURATION_MINUTES = 45;
const EARLY_ENTER_MINUTES = 5;

const INSIGHT_TEXTS: Record<string, string> = {
  'Relevant role exposure in previous projects.': '过往项目经历与目标岗位有较强相关性。',
  'Can explain practical implementation details.': '能够说明方案落地过程与实现细节。',
  'Answer quality fluctuates across turns.': '不同轮次回答质量波动较大，稳定性一般。',
  'Limited evidence for deep ownership.': '主导职责与结果证明相对不足。'
};

const defaultDatetimeLocal = () =>
  new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const defaultForm = (): InterviewForm => ({
  candidate_id: null,
  name: '周杰伦',
  stage: '三轮技术面 (系统设计)',
  position: 'Java高级架构师',
  schedule_time: defaultDatetimeLocal(),
  interviewer: '架构组长',
  location_type: '腾讯会议 (云端白板)'
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

function toScoringProfileLabel(value?: string | null): string {
  const key = String(value ?? '').trim().toLowerCase();
  return SCORING_PROFILE_LABELS[key] ?? '通用模板';
}

function toDimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key;
}

function toStatusLabel(value?: string | null): string {
  const key = String(value ?? '').trim().toLowerCase();
  return STATUS_LABELS[key] ?? (key || '待开始');
}

function normalizeRecommendationKey(value?: string | null): RecommendationFilter {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'hire' || key === 'hold' || key === 'needs_review' || key === 'reject') return key;
  return 'pending';
}

function scoreBandOf(score?: number | null): ScoreBand {
  const value = Number(score);
  if (!Number.isFinite(value)) return 'all';
  if (value < 60) return 'lt60';
  if (value < 80) return '60to79';
  return '80plus';
}

function riskBandOf(risk?: number | null): RiskBand {
  const value = Number(risk);
  if (!Number.isFinite(value)) return 'all';
  if (value >= 70) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
}

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, minutes);
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours > 0 && mins > 0) return `${hours}小时${mins}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${mins}分钟`;
}

function buildConclusionItems(report: ScoreReportView): string[] {
  const result: string[] = [];
  result.push(`建议结论：${toRecommendationLabel(report.recommendation)}`);
  result.push(`综合得分：${report.overall_score ?? '-'} 分，风险分：${report.risk_score ?? '-'} 分`);
  result.push(`有效回答：${report.answered_count ?? '-'} / ${report.question_count ?? '-'}`);
  if (report.min_answer_required !== undefined) {
    result.push(`最低有效回答要求：${report.min_answer_required ?? '-'}`);
  }
  if (report.scoring_profile) {
    result.push(`评分模板：${toScoringProfileLabel(report.scoring_profile)}`);
  }
  return result;
}

function buildEvidenceItems(report: ScoreReportView): string[] {
  const questionEvidence = (report.question_evaluations ?? []).slice(0, 3);
  if (questionEvidence.length > 0) {
    return questionEvidence.map((item, index) => {
      const no = (item.question_index ?? index) + 1;
      return `第 ${no} 题：${item.question || '（无题目）'}`;
    });
  }

  const evidence = (report.evidence ?? []).slice(0, 3);
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

function mapReportRowToView(row: InterviewReportRow): ScoreReportView {
  const rawDimension = row.dimension_scores as Record<string, unknown> | null;
  const dimensionScores = Object.fromEntries(
    Object.entries(rawDimension ?? {}).map(([key, value]) => [key, Number(value ?? 0)])
  );

  const strengths = Array.isArray(row.strengths)
    ? row.strengths.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const risks = Array.isArray(row.risks)
    ? row.risks.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.map((item) => {
        const data = (item ?? {}) as Record<string, unknown>;
        return {
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
    summary: row.summary,
    dimension_scores: dimensionScores,
    strengths,
    risks,
    evidence,
    question_evaluations: questionEvaluations,
    human_confirmed: row.human_confirmed,
    human_confirmed_at: row.human_confirmed_at
  };
}

function toInsightZh(text: string): string {
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
  const structured = String(report.summary ?? '').trim();
  if (structured) return structured;

  const overall = report.overall_score ?? '-';
  const risk = report.risk_score ?? '-';
  const answered = report.answered_count ?? '-';
  const total = report.question_count ?? '-';
  const minRequired = report.min_answer_required ?? '-';
  const recommendation = toRecommendationLabel(report.recommendation);
  return `综合评分 ${overall} 分，${recommendation}。风险评分 ${risk}。有效回答 ${answered}/${total}，最低有效回答要求 ${minRequired}。`;
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isPrefillFlow, setIsPrefillFlow] = useState(false);
  const [returnToPath, setReturnToPath] = useState<string | null>(null);
  const [runtimeBusyInterviewId, setRuntimeBusyInterviewId] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportInterviewName, setReportInterviewName] = useState('');
  const [reportData, setReportData] = useState<ScoreReportView | null>(null);
  const [reportInterviewId, setReportInterviewId] = useState('');
  const [reportReviewDecision, setReportReviewDecision] = useState<InterviewReportRow['recommendation']>('hire');
  const [reportReviewNote, setReportReviewNote] = useState('');
  const [submittingReportReview, setSubmittingReportReview] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [reportByInterviewId, setReportByInterviewId] = useState<Record<string, ScoreReportView>>({});

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState<RecommendationFilter>('all');
  const [scoreBandFilter, setScoreBandFilter] = useState<ScoreBand>('all');
  const [riskBandFilter, setRiskBandFilter] = useState<RiskBand>('all');
  const [reportOnlyFilter, setReportOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('schedule_desc');

  const [form, setForm] = useState<InterviewForm>(defaultForm());

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

    const endAt = scheduledAt + INTERVIEW_DURATION_MINUTES * 60 * 1000;
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
    return diffMin <= EARLY_ENTER_MINUTES && diffMin >= -INTERVIEW_DURATION_MINUTES;
  };

  const isEnded = (timeStr: string | null | undefined) => {
    if (!timeStr) return false;
    const scheduledAt = new Date(timeStr).getTime();
    if (Number.isNaN(scheduledAt)) return false;
    return clockNow > scheduledAt + INTERVIEW_DURATION_MINUTES * 60 * 1000;
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
    const { data } = await supabase.from('upcoming_interviews').select('*').order('created_at', { ascending: false });
    const rows = (data ?? []) as InterviewRow[];
    setInterviews(rows);
    await fetchReportsForInterviews(rows);
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
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const closeReportModal = () => {
    setReportModalOpen(false);
    setReportInterviewName('');
    setReportInterviewId('');
    setReportData(null);
    setReportReviewDecision('hire');
    setReportReviewNote('');
    setSubmittingReportReview(false);
  };

  const openReportModal = (interview: InterviewRow, report: ScoreReportView) => {
    setReportInterviewName(interview.name || '候选人');
    setReportInterviewId(interview.id);
    setReportData(report);
    setReportReviewDecision((report.recommendation as InterviewReportRow['recommendation']) ?? 'hire');
    setReportReviewNote('');
    setReportModalOpen(true);
  };

  const handleHumanConfirmReport = async (confirmed: boolean) => {
    let currentReportId = reportData?.id ?? '';
    if (!currentReportId && reportInterviewId) {
      try {
        const freshReport = await fetchInterviewReportByInterview(reportInterviewId);
        if (freshReport) {
          const mapped = mapReportRowToView(freshReport);
          setReportData(mapped);
          setReportByInterviewId((prev) => ({
            ...prev,
            [reportInterviewId]: mapped
          }));
          currentReportId = mapped.id ?? '';
        }
      } catch {
        // Keep the original guard below to show a stable message.
      }
    }

    if (!currentReportId || !reportInterviewId) {
      alert('缺少报告上下文，无法提交人工确认');
      return;
    }

    setSubmittingReportReview(true);
    try {
      const result = await interviewRuntimeEdge.humanConfirm<{ report?: InterviewReportRow }>({
        interviewId: reportInterviewId,
        reportId: currentReportId,
        confirmed,
        finalRecommendation: reportReviewDecision ?? null,
        note: reportReviewNote.trim() || null
      });

      const updatedRaw = result?.report;
      if (!updatedRaw) {
        throw new Error('人工确认已提交，但未返回更新后的报告');
      }

      const mapped = mapReportRowToView(updatedRaw);
      setReportData(mapped);
      setReportByInterviewId((prev) => ({
        ...prev,
        [reportInterviewId]: mapped
      }));
      await fetchInterviews();
    } catch (error) {
      alert(`人工确认失败：${toErrorMessage(error, 'unknown error')}`);
    } finally {
      setSubmittingReportReview(false);
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

  const visibleInterviews = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    const filtered = interviewsWithReport.filter(({ interview, report }) => {
      const status = String(interview.status ?? '').trim().toLowerCase();
      const decision = normalizeRecommendationKey(report?.recommendation);

      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (decisionFilter !== 'all' && decision !== decisionFilter) return false;
      if (reportOnlyFilter && !report) return false;

      if (scoreBandFilter !== 'all') {
        const band = scoreBandOf(report?.overall_score);
        if (band !== scoreBandFilter) return false;
      }

      if (riskBandFilter !== 'all') {
        const band = riskBandOf(report?.risk_score);
        if (band !== riskBandFilter) return false;
      }

      if (!keyword) return true;

      const haystack = [
        interview.name,
        interview.position,
        interview.stage,
        interview.interviewer,
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
  }, [interviewsWithReport, searchText, statusFilter, decisionFilter, scoreBandFilter, riskBandFilter, reportOnlyFilter, sortBy]);

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
      schedule_time: interview.schedule_time?.includes('T') ? interview.schedule_time : defaultDatetimeLocal(),
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
    const { error } = await supabase.from('upcoming_interviews').delete().eq('id', id);
    if (!error) {
      await fetchInterviews();
      setConfirmDeleteId(null);
    } else {
      alert(`删除失败：${error.message}`);
    }
  };

  const handleSaveInterview = async () => {
    if (!form.name || !form.position) return alert('请填写完整候选人与职位信息');

    setSaving(true);
    let apiError: { message: string } | null = null;

    if (editingId) {
      const { error } = await supabase.from('upcoming_interviews').update(form).eq('id', editingId);
      apiError = error as { message: string } | null;
    } else {
      const { error } = await supabase.from('upcoming_interviews').insert([form]);
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
      const report = (scored?.report ?? null) as ScoreReportView | null;
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12 relative">
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-end mb-8">
        <div>
          <h2 className="text-2xl font-medium text-on-surface mb-2">实时面试排期中控 (DB Linked)</h2>
          <p className="text-sm text-on-surface-variant">支持 AI 结构化初面：prepare/start/turn/finish/score 全流程。</p>
        </div>
        <button onClick={openNewModal} className="cursor-pointer bg-primary text-white px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 shadow-sm transition-colors flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> 新建排期 / 面试
        </button>
      </div>

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
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">应聘职位</label>
                  <input type="text" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">面试轮次</label>
                <input type="text" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">排期时间</label>
                  <input type="datetime-local" value={form.schedule_time} onChange={(e) => setForm({ ...form, schedule_time: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all cursor-pointer" />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">面试官</label>
                  <input type="text" value={form.interviewer} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">地点与形式</label>
                <input type="text" value={form.location_type} onChange={(e) => setForm({ ...form, location_type: e.target.value })} className="w-full bg-surface-container-low border border-transparent focus:border-primary px-3 py-2 rounded text-sm outline-none transition-all" />
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
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-outline-variant/15 flex justify-between items-center bg-surface-container-low/50">
              <h3 className="font-semibold text-on-surface">AI 评分报告 · {reportInterviewName}</h3>
              <button
                onClick={closeReportModal}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-md hover:bg-surface-container transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <p className="text-xs text-on-surface-variant">总分</p>
                    <p className="text-3xl font-bold text-on-surface">{reportData.overall_score ?? '-'}</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded border border-primary/20 bg-primary/10 text-primary tracking-wider font-semibold">
                    {toRecommendationLabel(reportData.recommendation)}
                  </span>
                  <span className="text-xs text-on-surface-variant">风险评分: {reportData.risk_score ?? '-'}</span>
                  <span
                    className={`text-xs px-2.5 py-1 rounded border ${
                      reportData.human_confirmed
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {reportData.human_confirmed ? '已人工确认' : '待人工确认'}
                  </span>
                </div>

              <div className="grid lg:grid-cols-3 gap-3 text-xs">
                <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-3">
                  <h4 className="text-sm font-semibold text-on-surface mb-2">结论</h4>
                  <div className="space-y-1.5">
                    {buildConclusionItems(reportData).map((line, idx) => (
                      <p key={`conclusion-${idx}`} className="text-on-surface-variant">{line}</p>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-3">
                  <h4 className="text-sm font-semibold text-on-surface mb-2">证据</h4>
                  <div className="space-y-2">
                    {buildEvidenceItems(reportData).map((line, idx) => (
                      <p key={`evidence-${idx}`} className="text-on-surface-variant whitespace-pre-wrap">{line}</p>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-3">
                  <h4 className="text-sm font-semibold text-on-surface mb-2">扣分原因</h4>
                  <div className="space-y-2">
                    {buildDeductionItems(reportData).map((line, idx) => (
                      <p key={`deduction-${idx}`} className="text-on-surface-variant whitespace-pre-wrap">{line}</p>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-on-surface mb-2">维度评分</h4>
                <div className="grid sm:grid-cols-2 gap-2">
                  {Object.entries(reportData.dimension_scores ?? {}).map(([dimension, score]) => (
                    <div key={dimension} className="rounded border border-outline-variant/20 px-3 py-2 text-xs flex justify-between bg-surface-container-low">
                      <span className="text-on-surface-variant">{toDimensionLabel(dimension)}</span>
                      <span className="font-semibold text-on-surface">{score}</span>
                    </div>
                  ))}
                </div>
              </div>

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

                <div className="rounded border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-xs text-on-surface">
                  {buildReportSummaryZh(reportData)}
                </div>

                <div className="rounded border border-outline-variant/20 bg-surface-container-low px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-on-surface">人工确认</h4>
                      <p className="text-xs text-on-surface-variant">
                        {reportData.human_confirmed
                          ? `已确认${reportData.human_confirmed_at ? ` · ${new Date(reportData.human_confirmed_at).toLocaleString()}` : ''}`
                          : '当前报告可提交人工确认并回写最终建议'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(['hire', 'hold', 'reject', 'needs_review'] as const).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        onClick={() => setReportReviewDecision(decision)}
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                          reportReviewDecision === decision
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant'
                        }`}
                      >
                        {toRecommendationLabel(decision)}
                      </button>
                    ))}
                  </div>

                  <textarea
                    value={reportReviewNote}
                    onChange={(e) => setReportReviewNote(e.target.value)}
                    rows={3}
                    placeholder="填写人工确认备注（可选）"
                    className="w-full rounded-md border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs text-on-surface outline-none focus:border-primary"
                  />

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleHumanConfirmReport(true)}
                      disabled={submittingReportReview}
                      className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submittingReportReview ? '提交中...' : '确认通过'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleHumanConfirmReport(false)}
                      disabled={submittingReportReview}
                      className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs font-medium text-error hover:bg-error/15 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submittingReportReview ? '提交中...' : '确认驳回'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3">
          <p className="text-[11px] text-on-surface-variant">待开始</p>
          <p className="text-xl font-semibold text-on-surface">{boardStats.scheduled}</p>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3">
          <p className="text-[11px] text-on-surface-variant">进行中</p>
          <p className="text-xl font-semibold text-primary">{boardStats.inProgress}</p>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3">
          <p className="text-[11px] text-on-surface-variant">已结束</p>
          <p className="text-xl font-semibold text-on-surface">{boardStats.completed}</p>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3">
          <p className="text-[11px] text-on-surface-variant">AI通过</p>
          <p className="text-xl font-semibold text-emerald-600">{boardStats.aiPass}</p>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3">
          <p className="text-[11px] text-on-surface-variant">AI淘汰</p>
          <p className="text-xl font-semibold text-error">{boardStats.aiReject}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-6 items-start">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm text-on-surface">筛选与排序</h3>

            <div className="space-y-1.5">
              <label className="text-[11px] text-on-surface-variant">搜索</label>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="候选人 / 岗位 / 面试官"
                className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[11px] text-on-surface-variant">状态</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-2 py-2 text-xs">
                  <option value="all">全部</option>
                  <option value="scheduled">待开始</option>
                  <option value="ready">待开始</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已结束</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-on-surface-variant">AI结论</label>
                <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value as RecommendationFilter)} className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-2 py-2 text-xs">
                  <option value="all">全部</option>
                  <option value="pending">待评分</option>
                  <option value="hire">通过</option>
                  <option value="hold">保留</option>
                  <option value="needs_review">复核</option>
                  <option value="reject">淘汰</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[11px] text-on-surface-variant">总分区间</label>
                <select value={scoreBandFilter} onChange={(e) => setScoreBandFilter(e.target.value as ScoreBand)} className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-2 py-2 text-xs">
                  <option value="all">全部</option>
                  <option value="80plus">80分及以上</option>
                  <option value="60to79">60-79分</option>
                  <option value="lt60">60分以下</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-on-surface-variant">风险区间</label>
                <select value={riskBandFilter} onChange={(e) => setRiskBandFilter(e.target.value as RiskBand)} className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-2 py-2 text-xs">
                  <option value="all">全部</option>
                  <option value="low">低风险</option>
                  <option value="medium">中风险</option>
                  <option value="high">高风险</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-on-surface-variant">排序</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="w-full rounded-md bg-surface-container-low border border-outline-variant/20 px-2 py-2 text-xs">
                <option value="schedule_desc">面试时间（最近优先）</option>
                <option value="schedule_asc">面试时间（最早优先）</option>
                <option value="score_desc">总分（高到低）</option>
                <option value="score_asc">总分（低到高）</option>
                <option value="risk_desc">风险（高到低）</option>
                <option value="updated_desc">更新时间（最近）</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              <input type="checkbox" checked={reportOnlyFilter} onChange={(e) => setReportOnlyFilter(e.target.checked)} />
              仅看已出报告
            </label>

            <div className="rounded-md bg-primary/10 border border-primary/20 px-3 py-2 text-xs text-primary">
              当前结果：{visibleInterviews.length} / {interviews.length}
            </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-on-surface mb-2">AI 面试流程</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">线上考场支持 prepare/start/turn/finish/score，全流程已打通。</p>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          {visibleInterviews.length === 0 ? (
            <div className="p-12 text-center text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-sm flex flex-col items-center justify-center gap-3">
              <Calendar className="w-8 h-8 text-outline-variant/50" />
              <p>{interviews.length === 0 ? '暂无排期记录，点击右上角新建一场面试吧。' : '当前筛选条件下无匹配场次，请调整筛选。'}</p>
            </div>
          ) : (
            visibleInterviews.map(({ interview, report }, idx) => (
              <div key={interview.id} className={`bg-surface-container-lowest border ${idx === 0 ? 'border-error/30 shadow-md' : 'border-outline-variant/15'} rounded-xl p-5 shadow-sm relative overflow-hidden transition-all group`}>
                <div className={`absolute top-0 left-0 w-1 h-full ${idx === 0 ? 'bg-error' : 'bg-surface-container-high group-hover:bg-primary transition-colors'}`} />
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-semibold text-base text-on-surface">{interview.stage || '待定轮次'}</h3>
                    <p className="text-sm text-on-surface-variant mt-1.5 flex gap-2 items-center">
                      <span className="font-medium text-on-surface">候选人: {interview.name}</span>
                      <span className="text-outline-variant">|</span>
                      面试官: {interview.interviewer || '未定专家'}
                    </p>
                    <p className="text-[11px] font-bold text-primary mt-2 uppercase tracking-wide bg-primary/10 w-fit px-2 py-0.5 rounded border border-primary/20">{interview.position || '未关联岗位'}</p>
                    <p className="text-[11px] text-on-surface-variant mt-2">状态: {toStatusLabel(interview.status)}{report ? ' · 已生成报告' : ''}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-md border border-outline-variant/20 bg-surface-container-low text-on-surface-variant">
                        总分: {report?.overall_score ?? '待评分'}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md border border-primary/20 bg-primary/10 text-primary">
                        结论: {report ? toRecommendationLabel(report.recommendation) : '待评分'}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md border border-outline-variant/20 bg-surface-container-low text-on-surface-variant">
                        风险: {report?.risk_score ?? '-'}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md border border-outline-variant/20 bg-surface-container-low text-on-surface-variant">
                        进度: {extractAnsweredProgress(report)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {(() => {
                      const res = getTimeRemaining(interview.schedule_time);
                      if (!res) return null;
                      return (
                        <span className={`${res.color} px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border flex items-center gap-1.5 shrink-0`}>
                          <Bell className={`w-3 h-3 ${res.pulse ? 'animate-bounce' : ''}`} /> {res.label}
                        </span>
                      );
                    })()}
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditModal(interview)} className="cursor-pointer text-on-surface-variant hover:text-primary transition-colors p-1.5 hover:bg-surface-container rounded-md">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {confirmDeleteId === interview.id ? (
                        <div className="flex bg-error/10 border border-error/20 rounded-md overflow-hidden">
                          <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 text-xs text-on-surface-variant hover:bg-error/5 transition-colors cursor-pointer">取消</button>
                          <button onClick={() => void handleDeleteConfirmed(interview.id)} className="px-2 py-1 text-xs text-error font-medium bg-error/10 hover:bg-error/20 transition-colors cursor-pointer">确认</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(interview.id)} className="cursor-pointer text-on-surface-variant hover:text-error transition-colors p-1.5 hover:bg-error-container/50 rounded-md">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 mt-4 pt-4 border-t border-outline-variant/10">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-on-surface">
                    <Clock className="w-4 h-4 text-on-surface-variant" />
                    {interview.schedule_time?.replace('T', ' ').slice(0, 16) || '待定排期'}
                  </div>
                  <div className={`flex items-center gap-1.5 text-sm font-medium ${isRemote(interview.location_type) ? 'text-primary' : 'text-on-surface-variant/60'}`}>
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
                        <div className="w-full rounded-xl border border-outline-variant/15 bg-surface-container-low p-4 space-y-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <button
                              onClick={() => void handlePrimaryAction(interview)}
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
                                    ? 'border-primary/20 bg-primary/10 text-primary'
                                    : step.state === 'active'
                                      ? 'border-secondary/25 bg-secondary/10 text-secondary'
                                      : 'border-outline-variant/20 bg-surface-container text-on-surface-variant/70'
                                }`}
                              >
                                {step.label}
                              </div>
                            ))}
                          </div>

                          <div>
                            {primaryAction.type === 'view_report' ? (
                              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-[11px] text-primary/85">
                                已完成，点击主按钮可直接查看报告
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
                              onClick={() => handleOpenRoomPage(interview)}
                              className="cursor-pointer bg-surface-container-high text-on-surface text-xs font-medium h-8 px-3 rounded-md hover:bg-surface-container-high/80 transition-colors border border-outline-variant/20"
                            >
                              打开考场页
                            </button>
                            <button
                              onClick={() => void handleCopyRoomLink(interview)}
                              className="cursor-pointer bg-surface-container-high text-on-surface-variant text-xs font-medium h-8 px-3 rounded-md hover:bg-surface-container-high/80 transition-colors border border-outline-variant/20"
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
              </div>
            ))
          )}

          {visibleInterviews.length > 0 && (
            <div className="bg-secondary-container/30 border border-secondary-container rounded-xl p-4 flex justify-between items-center text-xs">
              <span className="text-on-surface font-medium opacity-70">Supabase 实时同步中</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
































