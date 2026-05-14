import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, Loader2, Search, Trash2, UserRound, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import InterviewInviteModal from '../components/interviews/InterviewInviteModal';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

type CandidateListRow = {
  id: string;
  name: string | null;
  title: string | null;
  exp: string | null;
  exp_years: number | null;
  edu_level: string | null;
  edu: string | null;
  age: number | null;
  match: number | null;
  city: string | null;
};

type AdvancedFilters = {
  minMatch: string;
  minExpYears: string;
  education: string;
  cityKeyword: string;
};

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: AdvancedFilters = {
  minMatch: 'all',
  minExpYears: 'all',
  education: 'all',
  cityKeyword: '',
};

const EDUCATION_OPTIONS = ['大专', '本科', '硕士', '博士'];

const countActiveFilters = (filters: AdvancedFilters) =>
  Number(filters.minMatch !== 'all') +
  Number(filters.minExpYears !== 'all') +
  Number(filters.education !== 'all') +
  Number(filters.cityKeyword.trim() !== '');

const matchTone = (score: number) => {
  if (score >= 90) return 'border-[#d7efe4] bg-[#f6fffb] text-[#1f6b49]';
  if (score >= 75) return 'border-[#d7e5f7] bg-[#f7fbff] text-[#1f5fbf]';
  return 'border-[#dde8f5] bg-white text-[#5d7896]';
};

const buildCandidateSummary = (candidate: CandidateListRow) => {
  const parts = [
    `${candidate.exp_years ?? '-'} 年经验`,
    candidate.edu_level || candidate.edu || '学历未知',
    `${candidate.age ?? '-'} 岁`,
  ];
  if (candidate.city?.trim()) parts.push(candidate.city.trim());
  return parts.join(' · ');
};

export default function Candidates() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canDeleteCandidate = hasPermission('SCREEN_RESUMES');

  const [candidates, setCandidates] = useState<CandidateListRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [queryTerm, setQueryTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [inviteCandidate, setInviteCandidate] = useState<CandidateListRow | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState<AdvancedFilters>(DEFAULT_FILTERS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryTerm(searchTerm.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [filters.minMatch, filters.minExpYears, filters.education, filters.cityKeyword]);

  useEffect(() => {
    let cancelled = false;

    async function fetchCandidates() {
      setLoading(true);

      let query = supabase.from('candidates').select('*', { count: 'exact' }).order('created_at', { ascending: false });

      if (queryTerm) {
        query = query.or(`name.ilike.%${queryTerm}%,title.ilike.%${queryTerm}%,exp.ilike.%${queryTerm}%`);
      }

      if (filters.minMatch !== 'all') {
        query = query.gte('match', Number(filters.minMatch));
      }

      if (filters.minExpYears !== 'all') {
        query = query.gte('exp_years', Number(filters.minExpYears));
      }

      if (filters.education !== 'all') {
        query = query.ilike('edu_level', `%${filters.education}%`);
      }

      if (filters.cityKeyword.trim()) {
        query = query.ilike('city', `%${filters.cityKeyword.trim()}%`);
      }

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await query.range(from, to);

      if (cancelled) return;

      if (error) {
        setCandidates([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      setCandidates((data ?? []) as CandidateListRow[]);
      setTotalCount(count ?? 0);
      setLoading(false);
    }

    void fetchCandidates();

    return () => {
      cancelled = true;
    };
  }, [filters.cityKeyword, filters.education, filters.minExpYears, filters.minMatch, page, queryTerm, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPageCandidateIds = candidates.map((candidate) => candidate.id).filter(Boolean);
  const selectedOnPageCount = currentPageCandidateIds.filter((id) => selectedCandidateIds.includes(id)).length;
  const allOnPageSelected = currentPageCandidateIds.length > 0 && selectedOnPageCount === currentPageCandidateIds.length;
  const selectedCount = selectedCandidateIds.length;
  const activeFilterCount = countActiveFilters(filters);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [queryTerm, filters.cityKeyword, filters.education, filters.minExpYears, filters.minMatch]);

  const refreshCandidates = () => setReloadKey((prev) => prev + 1);

  const heroStats = useMemo(() => {
    const highMatchCount = candidates.filter((item) => (item.match ?? 0) >= 85).length;
    return {
      highMatchCount,
      selectedCount,
    };
  }, [candidates, selectedCount]);

  const toggleCandidateSelection = (candidateId: string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId]
    );
  };

  const toggleSelectCurrentPage = () => {
    setSelectedCandidateIds((prev) => {
      if (allOnPageSelected) {
        return prev.filter((id) => !currentPageCandidateIds.includes(id));
      }
      return Array.from(new Set([...prev, ...currentPageCandidateIds]));
    });
  };

  const clearSelection = () => setSelectedCandidateIds([]);

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const deleteCandidatesByIds = async (candidateIds: string[]) => {
    if (!canDeleteCandidate || candidateIds.length === 0 || batchDeleting) return false;

    setBatchDeleting(true);
    const { error } = await supabase.from('candidates').delete().in('id', candidateIds);
    setBatchDeleting(false);

    if (error) {
      window.alert(`删除失败：${error.message}`);
      return false;
    }

    const deletedSet = new Set(candidateIds);
    setSelectedCandidateIds((prev) => prev.filter((id) => !deletedSet.has(id)));

    if (inviteCandidate?.id && deletedSet.has(inviteCandidate.id)) setInviteCandidate(null);

    refreshCandidates();
    return true;
  };

  const handleDeleteCandidate = async (candidate: CandidateListRow) => {
    if (!canDeleteCandidate || !candidate.id) return;

    const name = candidate.name || '该候选人';
    const confirmed = window.confirm(`确认删除候选人「${name}」吗？删除后不可恢复。`);
    if (!confirmed) return;

    setDeletingCandidateId(candidate.id);
    await deleteCandidatesByIds([candidate.id]);
    setDeletingCandidateId(null);
  };

  const handleBatchDelete = async () => {
    if (!canDeleteCandidate || selectedCount === 0) return;

    const confirmed = window.confirm(`确认删除已选中的 ${selectedCount} 位候选人吗？删除后不可恢复。`);
    if (!confirmed) return;

    await deleteCandidatesByIds(selectedCandidateIds);
  };

  return (
    <div className="min-h-full bg-[#f5f9ff]">
      <div className="space-y-4 pb-12 animate-in fade-in duration-500">
        <section className="overflow-hidden rounded-[28px] border border-[#d9e5f2] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
          <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#bfd5f5] bg-[#f7fbff] px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-[#426a9a]">
                <Users className="h-3.5 w-3.5" />
                候选人中心
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-[#16355f]">候选人管理</h1>
                <p className="mt-2 text-sm text-[#5d7896]">统一查看候选人池和当前处理状态，再进入列表完成筛选与推进。</p>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[18px] border border-[#d8e4f4] bg-white p-3">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-[#6b86a4]">候选人总数</p>
                  <p className="mt-2 text-2xl font-semibold text-[#16355f]">{totalCount}</p>
                </div>
                <div className="rounded-[18px] border border-[#d7efe4] bg-[#f6fffb] p-3">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-[#4f856d]">高匹配候选人</p>
                  <p className="mt-2 text-2xl font-semibold text-[#1f6b49]">{heroStats.highMatchCount}</p>
                </div>
                <div className="rounded-[18px] border border-[#f0e2c9] bg-[#fffaf1] p-3">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-[#9b7a45]">已选中</p>
                  <p className="mt-2 text-2xl font-semibold text-[#7b5a22]">{heroStats.selectedCount}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-[#d9e5f2] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
          <div className="border-b border-[#e8eff7] px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-[#16355f]">候选人列表</h2>
                <p className="text-sm text-[#6b86a4]">搜索姓名、职位或经验，直接在列表里完成筛选和操作。</p>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
                <div className="relative min-w-0 flex-1 xl:w-80">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#89a6c7]" />
                  <input
                    type="text"
                    placeholder="搜索姓名、职位或经验..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full rounded-2xl border border-[#d7e5f7] bg-[#fbfdff] py-3 pl-11 pr-4 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters((prev) => !prev)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d7e5f7] bg-[#f7fbff] px-4 py-3 text-sm font-medium text-[#24476b] transition hover:bg-[#edf4fd]"
                >
                  <Filter className="h-4 w-4" />
                  高级筛选
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full border border-[#bfd5f5] bg-white px-2 py-0.5 text-[11px] text-[#1f5fbf]">
                      {activeFilterCount}
                    </span>
                  ) : null}
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {showAdvancedFilters ? (
              <div className="mt-5 rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4">
                <div className="grid gap-3 lg:grid-cols-4">
                  <label className="space-y-2">
                    <span className="text-xs font-medium text-[#6b86a4]">最低匹配度</span>
                    <select
                      value={filters.minMatch}
                      onChange={(event) => setFilters((prev) => ({ ...prev, minMatch: event.target.value }))}
                      className="w-full rounded-xl border border-[#d7e5f7] bg-white px-3 py-2.5 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                    >
                      <option value="all">不限</option>
                      <option value="60">60 分以上</option>
                      <option value="75">75 分以上</option>
                      <option value="85">85 分以上</option>
                      <option value="90">90 分以上</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-medium text-[#6b86a4]">最低经验</span>
                    <select
                      value={filters.minExpYears}
                      onChange={(event) => setFilters((prev) => ({ ...prev, minExpYears: event.target.value }))}
                      className="w-full rounded-xl border border-[#d7e5f7] bg-white px-3 py-2.5 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                    >
                      <option value="all">不限</option>
                      <option value="1">1 年以上</option>
                      <option value="3">3 年以上</option>
                      <option value="5">5 年以上</option>
                      <option value="8">8 年以上</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-medium text-[#6b86a4]">学历</span>
                    <select
                      value={filters.education}
                      onChange={(event) => setFilters((prev) => ({ ...prev, education: event.target.value }))}
                      className="w-full rounded-xl border border-[#d7e5f7] bg-white px-3 py-2.5 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                    >
                      <option value="all">不限</option>
                      {EDUCATION_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-medium text-[#6b86a4]">城市关键词</span>
                    <input
                      type="text"
                      value={filters.cityKeyword}
                      onChange={(event) => setFilters((prev) => ({ ...prev, cityKeyword: event.target.value }))}
                      placeholder="例如：北京、上海"
                      className="w-full rounded-xl border border-[#d7e5f7] bg-white px-3 py-2.5 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[#6b86a4]">筛选条件会实时作用到当前列表，并自动重置到第一页。</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={activeFilterCount === 0}
                    className="rounded-xl border border-[#d7e5f7] bg-white px-3 py-2 text-xs font-medium text-[#355b87] transition hover:bg-[#edf4fd] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    清空筛选
                  </button>
                </div>
              </div>
            ) : null}

            {canDeleteCandidate ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-3 text-xs text-[#5d7896]">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#d7e5f7] bg-white px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectCurrentPage}
                    disabled={loading || batchDeleting || currentPageCandidateIds.length === 0}
                    className="h-3.5 w-3.5 rounded border-[#bfd4ef] text-[#1f5fbf] focus:ring-[#1f5fbf]/20"
                  />
                  全选本页
                </label>
                <span>已选 {selectedCount} 位</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedCount === 0 || batchDeleting}
                  className="rounded-xl border border-[#d7e5f7] bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  清空选择
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchDelete()}
                  disabled={selectedCount === 0 || batchDeleting}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#f0d5dc] bg-[#fff7f8] px-3 py-2 font-medium text-[#a2506a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {batchDeleting ? '删除中...' : `删除选中（${selectedCount}）`}
                </button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-16">
              <Loader2 className="h-8 w-8 animate-spin text-[#6b86a4]" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="p-12">
              <div className="rounded-[24px] border border-dashed border-[#cddcf0] bg-[#f8fbff] px-6 py-14 text-center">
                <UserRound className="mx-auto h-9 w-9 text-[#89a6c7]" />
                <p className="mt-4 text-base font-medium text-[#24476b]">没有找到符合条件的候选人</p>
                <p className="mt-2 text-sm text-[#6b86a4]">你可以调整关键词或高级筛选条件，再继续筛选候选人。</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-4 sm:p-5">
              {candidates.map((candidate) => {
                const score = candidate.match ?? 0;
                const deleting = deletingCandidateId === candidate.id;

                return (
                  <article
                    key={candidate.id}
                    onClick={() => navigate(`/candidates/${candidate.id}`)}
                    className="group cursor-pointer rounded-[24px] border border-[#dde8f5] bg-white p-5 transition hover:border-[#c5d9ef] hover:bg-[#fcfdff]"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex items-start gap-4">
                        {canDeleteCandidate ? (
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.includes(candidate.id)}
                            onChange={() => toggleCandidateSelection(candidate.id)}
                            onClick={(event) => event.stopPropagation()}
                            disabled={batchDeleting || deleting}
                            className="mt-3 h-4 w-4 cursor-pointer rounded border-[#bfd4ef] text-[#1f5fbf] focus:ring-[#1f5fbf]/20"
                          />
                        ) : null}

                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-[#d6e2f1] bg-[#f4f8ff] text-lg font-semibold text-[#1f5fbf]">
                          {(candidate.name || '?').charAt(0)}
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-[#16355f] transition-colors group-hover:text-[#1f5fbf]">
                              {candidate.name || '未命名候选人'}
                            </h3>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${matchTone(score)}`}>
                              匹配度 {score}%
                            </span>
                          </div>

                          <div>
                            <p className="text-sm font-medium text-[#24476b]">{candidate.title || '未识别职位'}</p>
                            <p className="mt-1 text-sm text-[#5d7896]">{buildCandidateSummary(candidate)}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-[#d7e5f7] bg-[#f8fbff] px-3 py-1 text-[11px] font-semibold text-[#5d7896]">
                              候选人档案
                            </span>
                            <span className="rounded-full border border-[#d7e5f7] bg-white px-3 py-1 text-[11px] font-semibold text-[#5d7896]">
                              可进入详情核查
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setInviteCandidate(candidate);
                          }}
                          className="rounded-xl bg-[#1f5fbf] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#194f9e]"
                        >
                          邀约面试
                        </button>
                        {canDeleteCandidate ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteCandidate(candidate);
                            }}
                            disabled={batchDeleting || deleting}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#f0d5dc] bg-[#fff7f8] px-3 py-2.5 text-sm font-medium text-[#a2506a] transition hover:bg-[#fff0f3] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" />
                            {deleting ? '删除中...' : '删除'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-[#e8eff7] px-6 py-4 text-sm text-[#5d7896] sm:flex-row sm:items-center sm:justify-between">
            <span>
              当前显示 {candidates.length} / {totalCount} 位候选人
            </span>
            <div className="flex items-center gap-2">
              <span className="mr-2 text-sm font-medium text-[#5d7896]">
                第 {page} / {totalPages} 页
              </span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={loading || page <= 1}
                className="rounded-xl border border-[#d7e5f7] bg-[#f8fbff] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={loading || page >= totalPages}
                className="rounded-xl border border-[#d7e5f7] bg-[#f8fbff] px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </section>

        <InterviewInviteModal
          open={Boolean(inviteCandidate)}
          candidate={inviteCandidate}
          onClose={() => setInviteCandidate(null)}
          onSaved={() => navigate('/interviews')}
        />
      </div>
    </div>
  );
}
