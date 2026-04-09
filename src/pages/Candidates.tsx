import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Filter, Star, X, Send, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import InterviewInviteModal from '../components/interviews/InterviewInviteModal';
import { useAuth } from '../context/AuthContext';

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
};

const PAGE_SIZE = 20;

export default function Candidates() {
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
  const [chatCandidate, setChatCandidate] = useState<CandidateListRow | null>(null);
  const [inviteCandidate, setInviteCandidate] = useState<CandidateListRow | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [messages, setMessages] = useState<Array<{ id: number; text: string; recalled: boolean }>>([]);

  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canDeleteCandidate = hasPermission('SCREEN_RESUMES');

  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryTerm(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let cancelled = false;

    async function fetchCandidates() {
      setLoading(true);
      let query: any = supabase.from('candidates').select('*', { count: 'exact' }).order('created_at', { ascending: false });
      if (queryTerm) {
        query = query.or(`name.ilike.%${queryTerm}%,title.ilike.%${queryTerm}%,exp.ilike.%${queryTerm}%`);
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
  }, [page, queryTerm, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPageCandidateIds = candidates.map((candidate) => candidate.id).filter(Boolean);
  const selectedOnPageCount = currentPageCandidateIds.filter((id) => selectedCandidateIds.includes(id)).length;
  const allOnPageSelected = currentPageCandidateIds.length > 0 && selectedOnPageCount === currentPageCandidateIds.length;
  const selectedCount = selectedCandidateIds.length;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [queryTerm]);

  const refreshCandidates = () => setReloadKey((prev) => prev + 1);

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
      const merged = new Set([...prev, ...currentPageCandidateIds]);
      return Array.from(merged);
    });
  };

  const clearSelection = () => setSelectedCandidateIds([]);

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
    if (chatCandidate?.id && deletedSet.has(chatCandidate.id)) setChatCandidate(null);
    if (inviteCandidate?.id && deletedSet.has(inviteCandidate.id)) setInviteCandidate(null);
    refreshCandidates();
    return true;
  };

  const handleSend = () => {
    if (!chatMsg.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now(), text: chatMsg, recalled: false }]);
    setChatMsg('');
  };

  const handleRecall = (id: number) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, recalled: true } : m)));
  };

  const openChat = (candidate: CandidateListRow) => {
    setChatCandidate(candidate);
    setMessages([]);
  };

  const handleDeleteCandidate = async (candidate: CandidateListRow) => {
    if (!canDeleteCandidate || !candidate.id) return;
    const name = candidate.name || '该候选人';
    const confirmed = window.confirm(`确认删除候选人「${name}」吗？删除后不可恢复。`);
    if (!confirmed) return;

    setDeletingCandidateId(candidate.id);
    const success = await deleteCandidatesByIds([candidate.id]);
    setDeletingCandidateId(null);
    if (!success) return;
  };

  const handleBatchDelete = async () => {
    if (!canDeleteCandidate || selectedCount === 0) return;
    const confirmed = window.confirm(`确认删除已选中的 ${selectedCount} 位候选人吗？删除后不可恢复。`);
    if (!confirmed) return;
    await deleteCandidatesByIds(selectedCandidateIds);
  };

  return (
    <div className="relative space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
        <h2 className="text-2xl font-medium text-on-surface">
          全部候选人
          <span className="ml-2 text-base text-on-surface-variant">{totalCount} 位</span>
        </h2>
        <div className="flex w-full items-center gap-3 md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline-variant" />
            <input
              type="text"
              placeholder="搜索姓名、岗位或经验..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-outline-variant/30 bg-surface-container-lowest py-2 pl-9 pr-4 text-sm transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <button
            onClick={() => alert('高级筛选功能待接入')}
            className="cursor-pointer rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="inline-flex items-center gap-2">
              <Filter className="h-4 w-4" />
              筛选
            </span>
          </button>
        </div>
      </div>

      <section className="flex items-start gap-4 rounded-xl border border-primary/20 bg-primary-container/20 p-5">
        <Star className="mt-1 h-5 w-5 fill-primary text-primary" />
        <div>
          <h3 className="mb-1 text-sm font-medium text-on-surface">智能推荐</h3>
          <p className="text-sm text-on-surface-variant">根据岗位要求和简历解析结果，系统自动突出高匹配候选人。</p>
        </div>
      </section>

      {canDeleteCandidate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-low p-3 text-xs text-on-surface-variant">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-surface-container px-2.5 py-1.5">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={() => toggleSelectCurrentPage()}
              disabled={loading || batchDeleting || currentPageCandidateIds.length === 0}
              className="h-3.5 w-3.5 rounded border-outline-variant/30 text-primary focus:ring-primary/20"
            />
            全选本页
          </label>
          <span>已选 {selectedCount} 位</span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selectedCount === 0 || batchDeleting}
            className="rounded-md border border-outline-variant/25 bg-surface-container px-2.5 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            清空选择
          </button>
          <button
            type="button"
            onClick={() => void handleBatchDelete()}
            disabled={selectedCount === 0 || batchDeleting}
            className="inline-flex items-center gap-1.5 rounded-md border border-error/25 bg-error/10 px-2.5 py-1.5 font-medium text-error disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {batchDeleting ? '删除中...' : `删除选中（${selectedCount}）`}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-lowest shadow-[0_4px_16px_-4px_rgba(41,52,58,0.02)]">
        <div className="divide-y divide-outline-variant/15">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              onClick={() => navigate(`/candidates/${candidate.id}`)}
              className="group flex cursor-pointer items-center justify-between p-5 transition-colors hover:bg-surface-container-low"
            >
              <div className="flex items-center gap-5">
                <input
                  type="checkbox"
                  checked={selectedCandidateIds.includes(candidate.id)}
                  onChange={() => toggleCandidateSelection(candidate.id)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={batchDeleting || deletingCandidateId === candidate.id}
                  className="h-4 w-4 cursor-pointer rounded border-outline-variant/30 text-primary focus:ring-primary/20"
                />
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-lg font-medium text-on-surface">
                  {(candidate.name || '?').charAt(0)}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-3">
                    <h4 className="text-base font-medium text-on-surface transition-colors group-hover:text-primary">
                      {candidate.name || '未命名候选人'}
                    </h4>
                    <span
                      className={`rounded-full border border-outline-variant/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        (candidate.match ?? 0) >= 90
                          ? 'bg-primary-container/80 text-primary'
                          : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      匹配度 {candidate.match ?? 0}%
                    </span>
                  </div>
                  <p className="text-sm text-on-surface-variant">
                    <span className="font-medium text-on-surface">{candidate.title || '未识别职位'}</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    {candidate.exp_years ?? '-'} 年经验
                  </p>
                  <p className="mt-1.5 flex items-center gap-2 text-xs text-outline-variant">
                    <span className="rounded bg-surface-container px-2 py-0.5">{candidate.edu_level || candidate.edu || '学历未知'}</span>
                    <span className="rounded bg-surface-container px-2 py-0.5">{candidate.age ?? '-'} 岁</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setInviteCandidate(candidate);
                  }}
                  className="cursor-pointer rounded-md bg-primary-container/20 px-4 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary-container/40"
                >
                  邀约面试
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openChat(candidate);
                  }}
                  className="cursor-pointer rounded-md bg-surface-container px-4 py-1.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  发消息
                </button>
                {canDeleteCandidate && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteCandidate(candidate);
                    }}
                    disabled={batchDeleting || deletingCandidateId === candidate.id}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-error/25 bg-error/10 px-2.5 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingCandidateId === candidate.id ? '删除中...' : '删除'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {!loading && candidates.length === 0 && <div className="p-12 text-center text-on-surface-variant">未找到符合条件的候选人。</div>}
          {loading && <div className="p-12 text-center text-on-surface-variant">加载候选人中...</div>}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>
          第 {page} / {totalPages} 页 · 共 {totalCount} 位
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={loading || page <= 1}
            className="rounded border border-outline-variant/25 bg-surface-container-low px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={loading || page >= totalPages}
            className="rounded border border-outline-variant/25 bg-surface-container-low px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>

      {chatCandidate && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-outline-variant/20 bg-surface-container-lowest shadow-2xl animate-in slide-in-from-right duration-300 md:w-96">
          <div className="flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-primary">
                {(chatCandidate.name || '?').charAt(0)}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-on-surface">{chatCandidate.name || '未命名候选人'}</h3>
                <p className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                  在线
                </p>
              </div>
            </div>
            <button
              onClick={() => setChatCandidate(null)}
              className="cursor-pointer rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="hide-scrollbar flex flex-1 flex-col space-y-4 overflow-y-auto bg-surface-container-lowest/30 p-4">
            <div className="mb-2 flex justify-center">
              <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] text-on-surface-variant">今天 14:20</span>
            </div>
            <div className="w-fit max-w-[85%] rounded-xl rounded-tl-sm bg-surface-container-low p-3 text-sm text-on-surface shadow-sm">
              你好！我是 {chatCandidate.name || '候选人'}，对「{chatCandidate.title || '该职位'}」很感兴趣，期待进一步沟通。
            </div>

            {messages.map((m) =>
              m.recalled ? (
                <div key={m.id} className="mb-2 flex justify-center">
                  <span className="rounded-full bg-surface-container/50 px-2 py-0.5 text-[10px] text-on-surface-variant">你撤回了一条消息</span>
                </div>
              ) : (
                <div key={m.id} className="group relative mt-2 flex w-full items-center justify-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <button
                    onClick={() => handleRecall(m.id)}
                    className="cursor-pointer px-2 text-[10px] text-primary opacity-0 transition-all hover:text-error group-hover:opacity-100"
                  >
                    撤回
                  </button>
                  <div className="relative w-fit max-w-[85%] rounded-xl rounded-tr-sm bg-primary p-3 text-sm text-white shadow-sm">{m.text}</div>
                </div>
              )
            )}
          </div>

          <div className="border-t border-outline-variant/15 bg-surface-container-lowest p-4">
            <div className="flex gap-2">
              <input
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="输入消息..."
                className="flex-1 rounded-md border border-transparent bg-surface-container px-3 py-2.5 text-sm outline-none transition-all placeholder:text-outline-variant focus:border-primary"
              />
              <button
                onClick={handleSend}
                disabled={!chatMsg.trim()}
                className="flex cursor-pointer items-center justify-center rounded-md bg-primary px-3.5 py-2.5 text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <InterviewInviteModal
        open={Boolean(inviteCandidate)}
        candidate={inviteCandidate}
        onClose={() => setInviteCandidate(null)}
        onSaved={() => navigate('/interviews')}
      />
    </div>
  );
}
