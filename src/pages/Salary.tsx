import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  RefreshCcw,
  Save,
  ShieldAlert,
  Sparkles,
  UserRound,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  buildSalaryDecisionDashboardPayload,
  type SalaryDecisionDashboardCandidate,
  type SalaryDecisionDashboardPosition,
  type SalaryDecisionDashboardProfile,
  type SalaryDecisionDashboardResponse,
} from '../lib/salaryDecisionDashboard';
import { mapSalaryDecisionRow, type SalaryDecisionRowViewModel, type SalaryDecisionStatus } from '../lib/salaryDecisionViewModel';

type DraftFormState = {
  offerSalary: string;
  offerStatus: string;
  notes: string;
};

type EnrichedDecisionRow = SalaryDecisionDashboardProfile &
  SalaryDecisionRowViewModel & {
    candidate?: Record<string, unknown> | null;
    position?: Record<string, unknown> | null;
    market_benchmark?: Record<string, unknown> | null;
    market_position?: string | null;
  };

const OFFER_STATUS_OPTIONS = ['draft', 'offered', 'negotiating', 'accepted', 'declined'] as const;

const STATUS_META: Record<SalaryDecisionStatus, { label: string; tone: string }> = {
  proceed: { label: '建议推进', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  negotiate: { label: '建议谈判', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  hold: { label: '建议暂缓', tone: 'border-rose-200 bg-rose-50 text-rose-700' },
};

const MARKET_POSITION_META: Record<string, { label: string; tone: string }> = {
  below_market: { label: '低于市场', tone: 'border-sky-200 bg-sky-50 text-sky-700' },
  within_market: { label: '处于市场区间', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  above_market: { label: '高于市场', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  unknown: { label: '待判断', tone: 'border-slate-200 bg-slate-100 text-slate-700' },
};

const OFFER_STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'border-slate-200 bg-slate-100 text-slate-700' },
  offered: { label: '已发出', tone: 'border-sky-200 bg-sky-50 text-sky-700' },
  negotiating: { label: '谈判中', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  accepted: { label: '已接受', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  declined: { label: '已拒绝', tone: 'border-rose-200 bg-rose-50 text-rose-700' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未提供';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未更新';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function normalizeProfile(profile: Record<string, unknown>): EnrichedDecisionRow {
  const candidate = isRecord(profile.candidate) ? profile.candidate : null;
  const position = isRecord(profile.position) ? profile.position : null;
  const benchmark = isRecord(profile.market_benchmark) ? profile.market_benchmark : null;

  const candidateName = typeof candidate?.name === 'string' && candidate.name.trim() ? candidate.name : `候选人 ${profile.id}`;
  const positionTitle =
    (typeof position?.title === 'string' && position.title.trim()) ||
    (typeof candidate?.title === 'string' && candidate.title.trim()) ||
    '未命名岗位';
  const marketMin = toNumber(benchmark?.min_salary) ?? toNumber(profile.budget_min) ?? toNumber(profile.expected_salary_min) ?? 0;
  const marketMedian = toNumber(benchmark?.median_salary) ?? marketMin;
  const marketMax = toNumber(benchmark?.max_salary) ?? marketMedian;

  return {
    ...(profile as SalaryDecisionDashboardProfile),
    candidate,
    position,
    market_benchmark: benchmark,
    market_position: typeof profile.market_position === 'string' ? profile.market_position : 'unknown',
    ...mapSalaryDecisionRow({
      candidateName,
      positionTitle,
      candidateId: typeof profile.candidate_id === 'string' ? profile.candidate_id : null,
      positionId: typeof profile.position_id === 'string' ? profile.position_id : null,
      marketMin,
      marketMedian,
      marketMax,
      expectedMin: toNumber(profile.expected_salary_min),
      expectedMax: toNumber(profile.expected_salary_max),
      budgetMin: toNumber(profile.budget_min),
      budgetMax: toNumber(profile.budget_max),
      interviewStrength: 'mixed',
    }),
  };
}

async function loadDashboardFromSupabase(): Promise<SalaryDecisionDashboardResponse> {
  const { data: profilesData, error: profilesError } = await supabase
    .from('candidate_salary_profiles')
    .select('*')
    .order('updated_at', { ascending: false });

  if (profilesError) throw new Error(profilesError.message || '加载薪资档案失败');

  const profiles = ((profilesData ?? []) as SalaryDecisionDashboardProfile[]).filter(Boolean);
  const candidateIds = Array.from(new Set(profiles.map((item) => item.candidate_id).filter((value): value is string => Boolean(value))));
  const positionIds = Array.from(new Set(profiles.map((item) => item.position_id).filter((value): value is string => Boolean(value))));

  const [
    { data: candidatesData, error: candidatesError },
    { data: positionsData, error: positionsError },
    { data: benchmarksData, error: benchmarksError },
  ] = await Promise.all([
    candidateIds.length ? supabase.from('candidates').select('*').in('id', candidateIds) : Promise.resolve({ data: [], error: null }),
    positionIds.length ? supabase.from('active_positions').select('*').in('id', positionIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('market_salary_benchmarks').select('*').order('updated_at', { ascending: false }).limit(100),
  ]);

  if (candidatesError) throw new Error(candidatesError.message || '加载候选人数据失败');
  if (positionsError) throw new Error(positionsError.message || '加载岗位数据失败');
  if (benchmarksError) throw new Error(benchmarksError.message || '加载市场薪资基准失败');

  return buildSalaryDecisionDashboardPayload({
    profiles,
    candidates: (candidatesData ?? []) as SalaryDecisionDashboardCandidate[],
    positions: (positionsData ?? []) as SalaryDecisionDashboardPosition[],
    benchmarks: ((benchmarksData ?? []) as Record<string, unknown>[]) ?? [],
  });
}

export default function Salary() {
  const [dashboard, setDashboard] = useState<SalaryDecisionDashboardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFormState>({ offerSalary: '', offerStatus: 'draft', notes: '' });

  const loadDashboard = async () => {
    const nextDashboard = await loadDashboardFromSupabase();
    setDashboard(nextDashboard);
    setLoadingError(null);
    setSaveMessage(null);

    const profiles = (nextDashboard.profiles ?? []).filter(isRecord);
    const firstId = typeof profiles[0]?.id === 'string' ? profiles[0].id : null;
    setSelectedId((current) => (current && profiles.some((profile) => profile.id === current) ? current : firstId));
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setLoading(true);
      try {
        await loadDashboard();
      } catch (error) {
        if (!mounted) return;
        setDashboard(null);
        setLoadingError(error instanceof Error ? error.message : '加载薪资决策台失败');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(() => (dashboard?.profiles ?? []).filter(isRecord).map(normalizeProfile), [dashboard]);
  const selectedProfile = useMemo(() => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null, [rows, selectedId]);

  useEffect(() => {
    if (!selectedProfile) return;
    setDraft({
      offerSalary: selectedProfile.offer_salary == null ? '' : String(selectedProfile.offer_salary),
      offerStatus: typeof selectedProfile.offer_status === 'string' ? selectedProfile.offer_status : 'draft',
      notes: selectedProfile.notes ?? '',
    });
  }, [selectedProfile]);

  const statusCounts = rows.reduce<Record<SalaryDecisionStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { proceed: 0, negotiate: 0, hold: 0 },
  );

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await loadDashboard();
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : '刷新薪资决策台失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedProfile) return;

    setSaving(true);
    setSaveMessage(null);

    const { error } = await supabase
      .from('candidate_salary_profiles')
      .update({
        offer_salary: draft.offerSalary.trim() ? Number(draft.offerSalary) : null,
        offer_status: draft.offerStatus.trim() || 'draft',
        notes: draft.notes.trim() || null,
      })
      .eq('id', selectedProfile.id);

    if (error) {
      setSaving(false);
      setSaveMessage(error.message || '保存薪资档案失败');
      return;
    }

    await loadDashboard();
    setSaving(false);
    setSaveMessage('已保存到候选人薪资档案');
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in pb-10 duration-500">
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_32%),linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#1e293b_100%)] px-6 py-7 text-white shadow-[0_24px_64px_-40px_rgba(15,23,42,0.55)]">
          <div className="max-w-4xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100">
              <Wallet className="h-3.5 w-3.5" />
              Salary Decision Desk
            </div>
            <div className="space-y-2">
              <div className="h-10 w-72 rounded-2xl bg-white/10" />
              <div className="h-4 w-[min(720px,92%)] rounded-full bg-white/10" />
              <div className="h-4 w-[min(560px,84%)] rounded-full bg-white/10" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (loadingError) {
    return (
      <section className="overflow-hidden rounded-[30px] border border-rose-200 bg-[linear-gradient(135deg,_#fff5f5_0%,_#fff_55%,_#f8fafc_100%)] px-6 py-8 shadow-[0_18px_44px_-36px_rgba(190,18,60,0.45)]">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-rose-700">
            <AlertCircle className="h-3.5 w-3.5" />
            加载失败
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900">招聘薪资决策台无法加载</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{loadingError}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/15 transition-transform hover:-translate-y-0.5"
        >
          <RefreshCcw className="h-4 w-4" />
          重新加载
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in pb-10 duration-500">
      <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_30%),linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#1e293b_100%)] px-6 py-7 text-white shadow-[0_24px_64px_-40px_rgba(15,23,42,0.55)]">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div className="max-w-4xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100">
              <Wallet className="h-3.5 w-3.5" />
              Salary Decision Desk
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">薪资决策台</h2>
              <p className="hidden max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">
                页面直接读取 Supabase 里的薪资档案、候选人、岗位和市场基准数据，不再依赖本地 FastAPI 服务。
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center gap-2 text-cyan-100">
              <Sparkles className="h-4 w-4" />
              <h3 className="text-sm font-semibold">当前统计</h3>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <SummaryPill label="档案数" value={String(rows.length)} />
              <SummaryPill label="推进" value={String(statusCounts.proceed)} />
              <SummaryPill label="暂缓" value={String(statusCounts.hold)} />
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
            >
              <RefreshCcw className="h-4 w-4" />
              刷新数据
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="总档案数" value={rows.length} icon={UserRound} helper="当前可参与薪资决策的档案数量" />
        <SummaryCard title="建议推进" value={statusCounts.proceed} icon={CheckCircle2} helper="可直接推进报价的候选人" />
        <SummaryCard title="建议谈判" value={statusCounts.negotiate} icon={Wallet} helper="建议保留价格空间继续谈判" />
        <SummaryCard title="建议暂缓" value={statusCounts.hold} icon={ShieldAlert} helper="建议先补充信息或重新校准预算" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.18)]">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">决策列表</h3>
              <p className="mt-1 text-sm text-slate-500">选择任意一条档案，查看建议报价并保存草稿。</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">{rows.length} 条记录</div>
          </div>

          <div className="mt-4 space-y-3">
            {rows.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                暂无薪资档案数据。
              </div>
            ) : (
              rows.map((row) => {
                const isActive = row.id === selectedProfile?.id;
                const rowStatus = STATUS_META[row.status];
                const marketMeta = MARKET_POSITION_META[row.market_position ?? 'unknown'] ?? MARKET_POSITION_META.unknown;

                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`w-full rounded-[22px] border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_20px_44px_-32px_rgba(15,23,42,0.6)]'
                        : 'border-slate-200 bg-slate-50/60 text-slate-900 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isActive ? 'border-white/15 bg-white/10 text-white' : rowStatus.tone}`}>
                        {rowStatus.label}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isActive ? 'border-white/15 bg-white/10 text-white' : marketMeta.tone}`}>
                        {marketMeta.label}
                      </span>
                    </div>

                    <div className="mt-3">
                      <h4 className={`text-[15px] font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>{row.candidateName}</h4>
                      <p className={`mt-1 text-sm ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>{row.positionTitle}</p>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <CompactMetric label="市场区间" value={row.marketRangeLabel} active={isActive} />
                      <CompactMetric label="期望区间" value={row.expectedRangeLabel} active={isActive} />
                      <CompactMetric label="预算区间" value={row.budgetRangeLabel} active={isActive} />
                    </div>

                    <div className={`mt-4 flex items-center justify-between border-t pt-3 text-xs ${isActive ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-500'}`}>
                      <span>建议报价 {row.recommendedOfferRangeLabel}</span>
                      <span>{formatDateTime(row.updated_at ?? null)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-5">
          {selectedProfile ? (
            <>
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.18)]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_META[selectedProfile.status].tone}`}>
                        {STATUS_META[selectedProfile.status].label}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${MARKET_POSITION_META[selectedProfile.market_position ?? 'unknown']?.tone ?? MARKET_POSITION_META.unknown.tone}`}>
                        {MARKET_POSITION_META[selectedProfile.market_position ?? 'unknown']?.label ?? MARKET_POSITION_META.unknown.label}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${OFFER_STATUS_META[selectedProfile.offer_status ?? 'draft']?.tone ?? OFFER_STATUS_META.draft.tone}`}>
                        {OFFER_STATUS_META[selectedProfile.offer_status ?? 'draft']?.label ?? OFFER_STATUS_META.draft.label}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight text-slate-900">{selectedProfile.candidateName}</h3>
                      <p className="mt-1 text-sm text-slate-600">{selectedProfile.positionTitle}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <InfoTile icon={UserRound} label="候选人" value={selectedProfile.candidateName} />
                  <InfoTile icon={Building2} label="岗位" value={selectedProfile.positionTitle} />
                  <InfoTile icon={MapPin} label="地点" value={typeof selectedProfile.position?.location === 'string' ? selectedProfile.position.location : '未提供'} />
                  <InfoTile icon={Wallet} label="市场中位" value={formatCurrency(toNumber(selectedProfile.market_benchmark?.median_salary))} />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <ValueCard label="市场区间" value={selectedProfile.marketRangeLabel} />
                  <ValueCard label="期望区间" value={selectedProfile.expectedRangeLabel} />
                  <ValueCard label="预算区间" value={selectedProfile.budgetRangeLabel} />
                  <ValueCard label="建议报价" value={selectedProfile.recommendedOfferRangeLabel} highlight />
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.18)]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">保存草稿</h3>
                    <p className="mt-1 text-sm text-slate-500">直接写回 `candidate_salary_profiles`，不依赖本地 FastAPI 服务。</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? '保存中' : '保存草稿'}
                  </button>
                </div>

                <div className="mt-5 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Offer 预算</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.offerSalary}
                      onChange={(event) => setDraft((current) => ({ ...current, offerSalary: event.target.value }))}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                      placeholder="例如 38000"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Offer 状态</span>
                    <select
                      value={draft.offerStatus}
                      onChange={(event) => setDraft((current) => ({ ...current, offerStatus: event.target.value }))}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-slate-900"
                    >
                      {OFFER_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {OFFER_STATUS_META[option]?.label ?? option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">备注</span>
                    <textarea
                      rows={5}
                      value={draft.notes}
                      onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                      placeholder="记录审批理由、谈判策略或补充信息"
                    />
                  </label>
                </div>

                {saveMessage ? <p className="mt-4 text-sm text-slate-600">{saveMessage}</p> : null}
              </section>
            </>
          ) : (
            <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_18px_42px_-36px_rgba(15,23,42,0.18)]">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">请先选择一条薪资档案</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">左侧列表展示薪资决策档案。选中任意一条后，这里会显示详情和可保存的报价草稿。</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, helper }: { title: string; value: number; icon: typeof UserRound; helper: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.18)]">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/10">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{helper}</p>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-center">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function CompactMetric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${active ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
      <p className={`text-[11px] uppercase tracking-[0.18em] ${active ? 'text-slate-400' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 text-sm font-semibold ${active ? 'text-white' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function InfoTile({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
        <Icon className="h-4 w-4 text-sky-600" />
        {label}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ValueCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-[22px] border p-4 ${highlight ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}>
      <p className={`text-xs uppercase tracking-[0.18em] ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-2 text-sm font-semibold ${highlight ? 'text-white' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
