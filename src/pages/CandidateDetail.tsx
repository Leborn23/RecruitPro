import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileSearch,
  MapPin,
  MessageSquare,
  MinusCircle,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import InterviewInviteModal from '../components/interviews/InterviewInviteModal';
import { useAuth } from '../context/AuthContext';

type CandidateRow = {
  id: string;
  name: string;
  title: string | null;
  exp_years: number | null;
  edu_level: string | null;
  edu: string | null;
  age: number | null;
  match: number | null;
  tag: string | null;
  highlight: string | null;
  prev_company: string | null;
  city: string | null;
  created_at: string;
};

type MatchRow = {
  id: string;
  overall_score: number | null;
  recommendation: string | null;
  must_have_match_score: number | null;
  skill_match_score: number | null;
  project_relevance_score: number | null;
  experience_match_score: number | null;
  education_match_score: number | null;
  matched_skills: string[] | null;
  missing_skills: string[] | null;
  concerns: string[] | null;
  summary_reason: string | null;
  confidence: number | null;
  evidence_links: string[] | null;
  requirement_breakdown: Array<{ requirement: string; status: 'met' | 'not_met' | 'unknown'; reason: string }> | null;
  profile_id: string | null;
  human_decision: 'pass' | 'pending' | 'reject' | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
};

type ProjectRow = {
  id: string;
  project_name: string;
  project_summary: string | null;
  tech_stack: string[] | null;
  leadership_level: string | null;
  complexity_level: string | null;
};

type EvidenceSpan = {
  span_id: string;
  text_excerpt: string;
  page_no: number | null;
};

type RiskFlag = { type?: string; severity?: string; message?: string };

type ParserRawJson = { evidence_spans?: EvidenceSpan[] };
type SkillEvidence = {
  skill?: string;
  confidence?: number;
  evidence_span_ids?: string[];
  inference_reason?: string;
};
type ResumeProfileRow = {
  basic_profile?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    current_title?: string | null;
    years_of_experience?: number | null;
    education_level?: string | null;
  };
  explicit_skills?: SkillEvidence[];
  inferred_skills?: SkillEvidence[];
  work_experience?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
  certifications?: Array<Record<string, unknown>>;
  risk_flags?: RiskFlag[];
  extraction_confidence?: {
    overall?: number | null;
    by_section?: Record<string, number | null | undefined>;
  };
  parser_raw_json?: ParserRawJson;
};
type CandidateDetailRouteState = { matchId?: string; positionId?: string } | null;

const toPercent = (value: number | null | undefined): number => {
  if (value == null || Number.isNaN(value)) return 0;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
};

function severityClass(severity: string | undefined) {
  const s = (severity || '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'border-error/30 bg-error/10 text-error';
  if (s === 'low' || s === 'info') return 'border-outline-variant/25 bg-surface-container-low text-on-surface-variant';
  return 'border-secondary/35 bg-secondary-container/45 text-on-surface-variant';
}

const humanDecisionLabel = (decision: 'pass' | 'pending' | 'reject' | null): string | null => {
  if (decision === 'pass') return '人工通过';
  if (decision === 'pending') return '人工待定';
  if (decision === 'reject') return '人工淘汰';
  return null;
};

const humanDecisionClass = (decision: 'pass' | 'pending' | 'reject' | null): string => {
  if (decision === 'pass') return 'bg-primary/10 text-primary border-primary/25';
  if (decision === 'pending') return 'bg-secondary/10 text-secondary border-secondary/25';
  if (decision === 'reject') return 'bg-error/10 text-error border-error/25';
  return 'bg-surface-container text-on-surface-variant border-outline-variant/20';
};

export default function CandidateDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeState = location.state as CandidateDetailRouteState;
  const routeMatchId = (routeState?.matchId ?? searchParams.get('matchId') ?? '').trim();
  const routePositionId = (routeState?.positionId ?? searchParams.get('positionId') ?? '').trim();

  const [candidate, setCandidate] = useState<CandidateRow | null>(null);
  const [matchResult, setMatchResult] = useState<MatchRow | null>(null);
  const [resumeProfile, setResumeProfile] = useState<ResumeProfileRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [riskFlags, setRiskFlags] = useState<RiskFlag[]>([]);
  const [evidenceSpans, setEvidenceSpans] = useState<EvidenceSpan[]>([]);
  const [reviewDecision, setReviewDecision] = useState<'pass' | 'pending' | 'reject' | ''>('');
  const [reviewNote, setReviewNote] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [deletingCandidate, setDeletingCandidate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { hasPermission } = useAuth();
  const canDeleteCandidate = hasPermission('SCREEN_RESUMES');

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: candidateData } = await supabase.from('candidates').select('*').eq('id', id).single();
      if (!candidateData) {
        setCandidate(null);
        setMatchResult(null);
        setResumeProfile(null);
        setProjects([]);
        setRiskFlags([]);
        setEvidenceSpans([]);
        setLoading(false);
        return;
      }

      setCandidate(candidateData as CandidateRow);

      const fetchOneMatch = async (query: any): Promise<MatchRow | null> => {
        const { data } = await query.limit(1);
        return (data?.[0] as MatchRow | undefined) ?? null;
      };

      let latestMatch: MatchRow | null = null;
      if (routeMatchId) {
        latestMatch = await fetchOneMatch(
          supabase
            .from('candidate_position_matches')
            .select('*')
            .eq('candidate_id', id)
            .eq('id', routeMatchId)
        );
      }

      if (!latestMatch && routePositionId) {
        latestMatch = await fetchOneMatch(
          supabase
            .from('candidate_position_matches')
            .select('*')
            .eq('candidate_id', id)
            .eq('position_id', routePositionId)
            .order('created_at', { ascending: false })
        );
      }

      if (!latestMatch) {
        latestMatch = await fetchOneMatch(
          supabase
            .from('candidate_position_matches')
            .select('*')
            .eq('candidate_id', id)
            .order('created_at', { ascending: false })
        );
      }

      setMatchResult(latestMatch);

      if (latestMatch?.profile_id) {
        const [projectRes, profileRes] = await Promise.all([
          supabase
            .from('parsed_resume_projects')
            .select('id,project_name,project_summary,tech_stack,leadership_level,complexity_level')
            .eq('profile_id', latestMatch.profile_id)
            .order('project_index', { ascending: true }),
          supabase
            .from('parsed_resume_profiles')
            .select(
              'basic_profile,explicit_skills,inferred_skills,work_experience,education,certifications,risk_flags,extraction_confidence,parser_raw_json'
            )
            .eq('id', latestMatch.profile_id)
            .single(),
        ]);

        setResumeProfile((profileRes.data as ResumeProfileRow | null) ?? null);
        setProjects((projectRes.data as ProjectRow[]) || []);
        setRiskFlags(Array.isArray(profileRes.data?.risk_flags) ? (profileRes.data.risk_flags as RiskFlag[]) : []);

        const parserRaw = profileRes.data?.parser_raw_json as ParserRawJson | undefined;
        setEvidenceSpans(Array.isArray(parserRaw?.evidence_spans) ? parserRaw.evidence_spans : []);
      } else {
        setResumeProfile(null);
        setProjects([]);
        setRiskFlags([]);
        setEvidenceSpans([]);
      }

      setLoading(false);
    };

    void fetchData();
  }, [id, routeMatchId, routePositionId]);

  useEffect(() => {
    setReviewDecision((matchResult?.human_decision ?? '') as 'pass' | 'pending' | 'reject' | '');
    setReviewNote(matchResult?.review_note ?? '');
    setReviewError(null);
  }, [matchResult?.id, matchResult?.human_decision, matchResult?.review_note]);

  const saveManualReview = async () => {
    if (!matchResult?.id) return;
    setSavingReview(true);
    setReviewError(null);
    const decision = reviewDecision || null;
    const note = reviewNote.trim() || null;
    const now = new Date().toISOString();
    const shouldMarkReviewed = Boolean(decision || note);

    const { data, error } = await supabase
      .from('candidate_position_matches')
      .update({
        human_decision: decision,
        review_note: note,
        reviewed_at: shouldMarkReviewed ? now : null
      })
      .eq('id', matchResult.id)
      .select('*')
      .single();

    setSavingReview(false);
    if (error) {
      setReviewError(error.message || '保存人工复核失败');
      return;
    }
    if (data) {
      setMatchResult(data as MatchRow);
    }
  };

  const handleDeleteCandidate = async () => {
    if (!candidate?.id || !canDeleteCandidate || deletingCandidate) return;

    const name = candidate.name || '该候选人';
    const confirmed = window.confirm(`确认删除候选人「${name}」吗？删除后不可恢复。`);
    if (!confirmed) return;

    setDeletingCandidate(true);
    const { error } = await supabase.from('candidates').delete().eq('id', candidate.id);
    setDeletingCandidate(false);

    if (error) {
      window.alert(`删除失败：${error.message}`);
      return;
    }

    window.alert('候选人已删除');
    navigate('/candidates');
  };

  const recommendationLabel = useMemo(() => {
    const manual = humanDecisionLabel(matchResult?.human_decision ?? null);
    if (manual) return manual;
    if (!matchResult?.recommendation) return '待评估';
    if (matchResult.recommendation === 'strong_match') return '强匹配';
    if (matchResult.recommendation === 'partial_match') return '部分匹配';
    if (matchResult.recommendation === 'weak_match') return '弱匹配';
    return '不推荐';
  }, [matchResult?.human_decision, matchResult?.recommendation]);

  const recommendationClass = useMemo(() => {
    if (matchResult?.human_decision) return humanDecisionClass(matchResult.human_decision);
    if (!matchResult?.recommendation) return 'bg-surface-container text-on-surface-variant border-outline-variant/20';
    if (matchResult.recommendation === 'strong_match') return 'bg-primary/10 text-primary border-primary/25';
    if (matchResult.recommendation === 'partial_match') return 'bg-secondary-container/45 text-on-surface border-outline-variant/25';
    if (matchResult.recommendation === 'weak_match') return 'bg-secondary-container/30 text-on-surface-variant border-outline-variant/25';
    return 'bg-error/10 text-error border-error/25';
  }, [matchResult?.human_decision, matchResult?.recommendation]);

  const evidencePreview = useMemo(() => {
    if (!matchResult?.evidence_links?.length || !evidenceSpans.length) return [];
    const set = new Set(matchResult.evidence_links);
    return evidenceSpans.filter((item) => set.has(item.span_id)).slice(0, 5);
  }, [matchResult?.evidence_links, evidenceSpans]);

  const evidenceById = useMemo(() => {
    const map = new Map<string, EvidenceSpan>();
    evidenceSpans.forEach((item) => map.set(item.span_id, item));
    return map;
  }, [evidenceSpans]);

  const resolveEvidenceText = (ids: string[] | undefined): string => {
    const first = safeArray(ids)
      .map((spanId) => evidenceById.get(spanId)?.text_excerpt)
      .find((text) => Boolean(cleanText(text)));
    return cleanText(first);
  };

  const overallScore = toPercent(matchResult?.overall_score ?? candidate?.match ?? 0);
  const confidenceScore = toPercent(matchResult?.confidence);
  const profileConfidence = toPercent(resumeProfile?.extraction_confidence?.overall);

  const basicProfile = resumeProfile?.basic_profile ?? {};
  const explicitSkills = safeArray(resumeProfile?.explicit_skills)
    .filter((item) => cleanText(item.skill))
    .slice(0, 14);
  const inferredSkills = safeArray(resumeProfile?.inferred_skills)
    .filter((item) => cleanText(item.skill))
    .slice(0, 8);
  const profileEducation = safeArray(resumeProfile?.education).slice(0, 3);
  const profileWorkExperience = safeArray(resumeProfile?.work_experience).slice(0, 3);
  const profileCertifications = safeArray(resumeProfile?.certifications).slice(0, 4);

  const profileFacts = [
    { label: '联系电话', value: cleanText(basicProfile.phone) || '未识别' },
    { label: '邮箱', value: cleanText(basicProfile.email) || '未识别' },
    { label: '当前岗位', value: cleanText(basicProfile.current_title) || candidate?.title || '未识别' },
    {
      label: '经验年限',
      value:
        basicProfile.years_of_experience != null
          ? `${basicProfile.years_of_experience} 年`
          : candidate?.exp_years != null
            ? `${candidate.exp_years} 年`
            : '未识别',
    },
    { label: '学历', value: cleanText(basicProfile.education_level) || candidate?.edu_level || candidate?.edu || '未识别' },
    { label: '解析置信度', value: `${profileConfidence}%` },
  ];

  const allRiskItems = useMemo(() => {
    const merged = [
      ...riskFlags.map((item) => ({
        message: item.message || riskTypeLabel(item.type),
        severity: item.severity,
        type: item.type,
      })),
      ...(matchResult?.concerns || []).map((message) => ({ message, severity: 'warning' })),
    ];

    const seen = new Set<string>();
    return merged.filter((item) => {
      const msg = String(item.message || '').trim();
      if (!msg) return false;
      const key = msg.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [riskFlags, matchResult?.concerns]);

  const scoreBreakdown = [
    { label: '硬性要求', value: toPercent(matchResult?.must_have_match_score) },
    { label: '技能匹配', value: toPercent(matchResult?.skill_match_score) },
    { label: '项目相关度', value: toPercent(matchResult?.project_relevance_score) },
    { label: '经验匹配', value: toPercent(matchResult?.experience_match_score) },
    { label: '学历匹配', value: toPercent(matchResult?.education_match_score) },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-outline-variant/15 bg-surface-container-lowest">
        <p className="text-sm text-on-surface-variant">加载候选人详情中...</p>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-8 text-center text-on-surface-variant">
        未找到候选人数据。
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f5f9ff]">
      <div className="space-y-5 pb-20">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-[#c7daf6] bg-[#f4f8ff] px-4 py-2.5 text-sm font-medium text-[#24476b] transition hover:bg-[#e9f1ff]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回候选人列表
        </button>

      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-[#d6e2f1] bg-[#f4f8ff] text-xl font-bold text-[#1f5fbf]">
              {candidate.name?.charAt(0) ?? '?'}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-[#426a9a]">
                <FileSearch className="h-3.5 w-3.5" />
                候选人详情
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-3xl font-semibold tracking-tight text-[#16355f]">{candidate.name}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${recommendationClass}`}>
                  {recommendationLabel || candidate.tag || '待评估'}
                </span>
              </div>
              <p className="text-sm text-[#5d7896]">{candidate.title || '未识别职位'}</p>
              <div className="flex flex-wrap gap-2 text-xs text-[#5d7896]">
                <span className="rounded-md border border-[#d6e2f1] bg-[#f8fbff] px-2 py-1">{candidate.exp_years ?? '-'} 年经验</span>
                <span className="rounded-md border border-[#d6e2f1] bg-[#f8fbff] px-2 py-1">{candidate.edu_level || candidate.edu || '学历未知'}</span>
                <span className="rounded-md border border-[#d6e2f1] bg-[#f8fbff] px-2 py-1">{candidate.age ?? '-'} 岁</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-[#d6e2f1] bg-[#f8fbff] px-2 py-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {candidate.prev_company || '未知公司'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-[#d6e2f1] bg-[#f8fbff] px-2 py-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {candidate.city || '未知城市'}
                </span>
              </div>
            </div>
          </div>

            <div className="space-y-3">
              <button
                onClick={() => setInviteOpen(true)}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#1f5fbf] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#194f9e]"
              >
                <MessageSquare className="h-4 w-4" />
                邀约面试
            </button>
            {canDeleteCandidate && (
              <button
                type="button"
                onClick={() => void handleDeleteCandidate()}
                disabled={deletingCandidate}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {deletingCandidate ? '删除中...' : '删除候选人'}
              </button>
            )}
            <div className="grid grid-cols-3 gap-2 rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-3">
              <div>
                <p className="text-[11px] text-[#6b86a4]">总分</p>
                <p className="text-lg font-semibold text-[#16355f]">{overallScore}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6b86a4]">置信度</p>
                <p className="text-lg font-semibold text-[#16355f]">{confidenceScore}%</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6b86a4]">风险数</p>
                <p className={`text-lg font-semibold ${allRiskItems.length > 0 ? 'text-error' : 'text-[#16355f]'}`}>{allRiskItems.length}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#16355f]">档案概览</h3>
            <p className="mt-1 text-xs text-[#6b86a4]">来自简历结构化解析，缺失项需要人工复核。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {profileCertifications.map((item, index) => {
              const name = cleanText(item.name) || cleanText(item.certification) || cleanText(item.title);
              return name ? (
                <span key={`${name}-${index}`} className="rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-2.5 py-1 text-xs text-primary">
                  {name}
                </span>
              ) : null;
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {profileFacts.map((item) => (
            <div key={item.label} className="rounded-[18px] border border-[#d6e2f1] bg-[#f8fbff] p-3">
              <p className="text-[11px] text-[#6b86a4]">{item.label}</p>
              <p className="mt-1 min-h-5 truncate text-sm font-semibold text-[#16355f]" title={String(item.value)}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
        {(profileWorkExperience.length > 0 || profileEducation.length > 0) && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {profileWorkExperience.length > 0 && (
              <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] p-4">
                <p className="mb-2 text-xs font-semibold text-[#426a9a]">近期经历</p>
                <div className="space-y-2">
                  {profileWorkExperience.map((item, index) => {
                    const company = cleanText(item.company) || cleanText(item.company_name) || '未识别公司';
                    const title = cleanText(item.title) || cleanText(item.role) || cleanText(item.position) || '未识别岗位';
                    const period = cleanText(item.period) || cleanText(item.duration) || '';
                    return (
                      <div key={`${company}-${index}`} className="text-xs leading-relaxed text-[#24476b]">
                        <span className="font-semibold text-[#16355f]">{company}</span>
                        <span> · {title}</span>
                        {period && <span className="text-[#6b86a4]"> · {period}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {profileEducation.length > 0 && (
              <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] p-4">
                <p className="mb-2 text-xs font-semibold text-[#426a9a]">教育经历</p>
                <div className="space-y-2">
                  {profileEducation.map((item, index) => {
                    const school = cleanText(item.school) || cleanText(item.university) || '未识别学校';
                    const degree = cleanText(item.degree) || cleanText(item.level) || '';
                    const major = cleanText(item.major) || '';
                    return (
                      <div key={`${school}-${index}`} className="text-xs leading-relaxed text-[#24476b]">
                        <span className="font-semibold text-[#16355f]">{school}</span>
                        {(degree || major) && <span> · {[degree, major].filter(Boolean).join(' / ')}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(280px,1fr)]">
        <div className="space-y-5">
          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-[#16355f]">
              <Sparkles className="h-4 w-4 text-primary" />
              可解释匹配结果
            </h3>

            {matchResult ? (
              <div className="space-y-4">
                <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[#6b86a4]">
                    <span>综合匹配度</span>
                    <span>{overallScore}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${overallScore}%` }} />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[#24476b]">
                    {matchResult.summary_reason || candidate.highlight || '暂无匹配说明'}
                  </p>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
                  <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="flex items-center gap-1 text-xs font-semibold text-primary">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        简历技能证据
                      </p>
                      <span className="text-[11px] text-[#6b86a4]">明确 {explicitSkills.length} / 推断 {inferredSkills.length}</span>
                    </div>
                    {explicitSkills.length === 0 && inferredSkills.length === 0 ? (
                      <p className="text-xs text-on-surface-variant">暂无可展示的技能证据。</p>
                    ) : (
                      <div className="space-y-2.5">
                        {explicitSkills.slice(0, 8).map((item, index) => {
                          const evidenceText = resolveEvidenceText(item.evidence_span_ids);
                          return (
                            <div key={`${item.skill}-${index}`} className="rounded-xl border border-[#d6e2f1] bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-[#16355f]">{item.skill}</span>
                                <span className="text-[11px] text-[#6b86a4]">置信度 {formatPercent(item.confidence)}</span>
                              </div>
                              {evidenceText && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#5d7896]">{evidenceText}</p>}
                            </div>
                          );
                        })}
                        {inferredSkills.slice(0, 4).map((item, index) => (
                          <div key={`${item.skill}-${index}`} className="rounded-xl border border-[#d6e2f1] bg-[#f8fbff] px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-[#24476b]">{item.skill}</span>
                              <span className="rounded-full border border-[#d6e2f1] bg-white px-2 py-0.5 text-[11px] text-[#6b86a4]">推断</span>
                            </div>
                            {item.inference_reason && <p className="mt-1 text-xs leading-relaxed text-[#5d7896]">{item.inference_reason}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[20px] border border-[#f1d8de] bg-[#fff6f8] p-4">
                    <p className="mb-3 flex items-center gap-1 text-xs font-semibold text-error">
                      <XCircle className="h-3.5 w-3.5" />
                      岗位缺口
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(matchResult.missing_skills || []).slice(0, 10).map((skill) => (
                        <span key={skill} className="rounded-md border border-error/20 bg-white px-2 py-0.5 text-xs text-error">
                          {skill}
                        </span>
                      ))}
                      {(matchResult.missing_skills || []).length === 0 && <span className="text-xs text-on-surface-variant">无明显缺失技能</span>}
                    </div>
                    {(matchResult.matched_skills || []).length > 0 && (
                      <div className="mt-4 border-t border-error/10 pt-3">
                        <p className="mb-2 text-xs font-semibold text-[#6b86a4]">岗位命中</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(matchResult.matched_skills || []).slice(0, 10).map((skill) => (
                            <span key={skill} className="rounded-md border border-[#c7daf6] bg-white px-2 py-0.5 text-xs text-primary">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {matchResult.requirement_breakdown && matchResult.requirement_breakdown.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6b86a4]">要求项分解</p>
                    {matchResult.requirement_breakdown.map((item, idx) => (
                      <div
                        key={`${item.requirement}-${idx}`}
                        className={`rounded-lg border p-3 ${
                          item.status === 'met'
                            ? 'border-primary/20 bg-primary/5'
                            : item.status === 'unknown'
                              ? 'border-outline-variant/20 bg-surface-container-low'
                              : 'border-error/20 bg-error/5'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {item.status === 'met' ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                          ) : item.status === 'unknown' ? (
                            <MinusCircle className="mt-0.5 h-4 w-4 text-on-surface-variant" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-4 w-4 text-error" />
                          )}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-on-surface">{item.requirement}</p>
                              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[11px]">
                                {requirementStatusLabel(item.status)}
                              </span>
                            </div>
                            <p className="text-xs text-on-surface-variant">{item.reason}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {evidencePreview.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#6b86a4]">证据片段</p>
                    {evidencePreview.map((item) => (
                      <div key={item.span_id} className="rounded-[18px] border border-[#d6e2f1] bg-[#f8fbff] p-3">
                        <p className="text-xs leading-relaxed text-[#24476b]">{item.text_excerpt}</p>
                        <p className="mt-1 text-[11px] text-[#6b86a4]">
                          {item.span_id}
                          {item.page_no != null ? ` · page ${item.page_no}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                当前候选人暂无 AI 匹配结果，请先在筛选页上传并处理简历。
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-[#16355f]">
              <Briefcase className="h-4 w-4 text-primary" />
              相关项目经历
            </h3>
            {projects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                暂无项目经历数据。
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div key={project.id} className="rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-[#16355f]">{project.project_name}</p>
                      {(project.complexity_level || project.leadership_level) && (
                        <span className="rounded-md border border-[#d6e2f1] bg-white px-2 py-0.5 text-[11px] text-[#6b86a4]">
                          {[project.complexity_level, project.leadership_level].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-[#5d7896]">{project.project_summary || '暂无项目摘要'}</p>
                    {(project.tech_stack || []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(project.tech_stack || []).map((tech) => (
                          <span key={tech} className="rounded-md border border-[#c7daf6] bg-white px-2 py-0.5 text-[11px] text-primary">
                            {tech}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#16355f]">
              <FileSearch className="h-4 w-4 text-primary" />
              分项分数
            </h3>
            <div className="space-y-3">
              {scoreBreakdown.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-[#6b86a4]">{item.label}</span>
                    <span className="font-medium text-[#16355f]">{item.value}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#edf3fb]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#16355f]">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              人工复核
            </h3>
            {matchResult ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewDecision('pass')}
                    className={`rounded-md border px-2.5 py-1 text-xs ${reviewDecision === 'pass' ? humanDecisionClass('pass') : humanDecisionClass(null)}`}
                  >
                    通过
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('pending')}
                    className={`rounded-md border px-2.5 py-1 text-xs ${reviewDecision === 'pending' ? humanDecisionClass('pending') : humanDecisionClass(null)}`}
                  >
                    待定
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('reject')}
                    className={`rounded-md border px-2.5 py-1 text-xs ${reviewDecision === 'reject' ? humanDecisionClass('reject') : humanDecisionClass(null)}`}
                  >
                    淘汰
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewDecision('');
                      setReviewNote('');
                    }}
                    className="rounded-md border border-outline-variant/25 bg-surface-container px-2.5 py-1 text-xs text-on-surface-variant"
                  >
                    清空
                  </button>
                </div>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  rows={3}
                  placeholder="填写人工复核备注（可选）"
                  className="w-full resize-y rounded-md border border-outline-variant/25 bg-surface-container-low px-3 py-2 text-xs text-on-surface outline-none focus:border-primary"
                />
                {reviewError && <p className="text-xs text-error">{reviewError}</p>}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-on-surface-variant">
                    当前状态：{humanDecisionLabel(matchResult.human_decision) || '未复核'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveManualReview()}
                    disabled={savingReview}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingReview ? '保存中...' : '保存复核'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">暂无可复核的匹配记录</p>
            )}
          </section>

          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#16355f]">
              <ShieldAlert className="h-4 w-4 text-error" />
              风险与提示
            </h3>
            {allRiskItems.length === 0 ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">未发现明显风险项</div>
            ) : (
              <div className="space-y-2">
                {allRiskItems.map((item, idx) => {
                  const severity = (item.severity || 'warning').toLowerCase();
                  return (
                    <div key={`${item.message}-${idx}`} className={`rounded-lg border p-3 text-xs ${severityClass(severity)}`}>
                      <p className="font-semibold uppercase tracking-wide">[{severity}]</p>
                      <p className="mt-1">{item.message}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#16355f]">
              <UserRound className="h-4 w-4 text-primary" />
              档案信息
            </h3>
            <div className="space-y-2 text-xs text-[#5d7896]">
              <p className="break-all">候选人 ID: {candidate.id}</p>
              <p className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                创建时间: {new Date(candidate.created_at).toLocaleString()}
              </p>
              {matchResult?.created_at && (
                <p className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  匹配时间: {new Date(matchResult.created_at).toLocaleString()}
                </p>
              )}
              {matchResult?.reviewed_at && (
                <p className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  复核时间: {new Date(matchResult.reviewed_at).toLocaleString()}
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

        <InterviewInviteModal
          open={inviteOpen}
          candidate={candidate}
          onClose={() => setInviteOpen(false)}
          onSaved={() => navigate('/interviews')}
        />
      </div>
    </div>
  );
}

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatPercent = (value: number | null | undefined): string => `${toPercent(value)}%`;

const safeArray = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const requirementStatusLabel = (status: 'met' | 'not_met' | 'unknown') => {
  if (status === 'met') return '已满足';
  if (status === 'not_met') return '缺口';
  return '待确认';
};

const riskTypeLabel = (type: string | undefined) => {
  const normalized = (type || '').toLowerCase();
  if (normalized === 'llm_evidence_rejected') return '证据不足';
  if (normalized === 'missing_contact') return '联系方式缺失';
  if (normalized === 'low_quality_text') return '简历文本质量低';
  if (normalized === 'missing_skills') return '技能信息不足';
  return type || '风险提示';
};
