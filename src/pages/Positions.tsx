import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  AlertTriangle,
  BriefcaseBusiness,
  ChevronRight,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

type PositionForm = {
  title: string;
  department: string;
  location: string;
  status: string;
  threshold_score: number;
  technical_requirements: string;
  max_age: number;
  min_edu: string;
  min_exp: number;
};

type PositionRow = PositionForm & {
  id: string;
  created_at?: string | null;
};

const DEFAULT_FORM: PositionForm = {
  title: '',
  department: '核心开发部',
  location: '北京 / 杭州',
  status: '常规',
  threshold_score: 80,
  technical_requirements: '',
  max_age: 40,
  min_edu: '本科',
  min_exp: 2,
};

const DEPARTMENTS = ['核心开发部', '基础架构部', '大模型实验室', '云原生安全部'];
const STATUSES = ['紧急', '常规', '储备'];
const EDUCATION_OPTIONS = ['专科', '本科', '硕士', '博士'];

const statusToneMap: Record<string, string> = {
  紧急: 'text-rose-700 bg-rose-50 border-rose-200',
  常规: 'text-sky-700 bg-sky-50 border-sky-200',
  储备: 'text-slate-700 bg-slate-100 border-slate-200',
};

function createRiskSummary(position: PositionForm) {
  const risks: string[] = [];
  if (position.threshold_score >= 90) risks.push('推荐阈值偏高，候选池可能过窄');
  if (position.max_age <= 32) risks.push('年龄上限较紧，可能压缩可选范围');
  if (position.min_exp >= 8) risks.push('经验要求较高，筛选成本会升高');
  if (position.technical_requirements.trim().length < 36) risks.push('技术要求描述过短，系统难以稳定判断重点');
  return risks;
}

function splitHighlights(requirements: string) {
  return requirements
    .split(/[\n,锛屻€傦紱;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export default function Positions() {
  const [form, setForm] = useState<PositionForm>(DEFAULT_FORM);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPositions = async () => {
    setLoading(true);
    const { data } = await supabase.from('active_positions').select('*').order('created_at', { ascending: false });
    const nextPositions = (data ?? []) as PositionRow[];
    setPositions(nextPositions);

    setSelectedPositionId((current) => {
      if (current && nextPositions.some((item) => item.id === current)) return current;
      return nextPositions[0]?.id ?? null;
    });

    setLoading(false);
  };

  useEffect(() => {
    void fetchPositions();
  }, []);

  const selectedPosition =
    positions.find((item) => item.id === selectedPositionId) ?? positions[0] ?? null;

  const urgentCount = positions.filter((item) => item.status === '紧急').length;
  const averageThreshold =
    positions.length > 0
      ? Math.round(positions.reduce((sum, item) => sum + Number(item.threshold_score || 0), 0) / positions.length)
      : 0;
  const highRiskCount = positions.filter((item) => createRiskSummary(item).length > 0).length;

  const selectedHighlights = useMemo(
    () => splitHighlights(selectedPosition?.technical_requirements ?? ''),
    [selectedPosition]
  );

  const selectedRisks = useMemo(
    () => (selectedPosition ? createRiskSummary(selectedPosition) : []),
    [selectedPosition]
  );

  const openCreateDrawer = () => {
    setEditingPositionId(null);
    setForm(DEFAULT_FORM);
    setDrawerOpen(true);
  };

  const openEditDrawer = (position: PositionRow) => {
    setEditingPositionId(position.id);
    setForm({
      title: position.title ?? '',
      department: position.department ?? DEFAULT_FORM.department,
      location: position.location ?? '',
      status: position.status ?? DEFAULT_FORM.status,
      threshold_score: Number(position.threshold_score ?? DEFAULT_FORM.threshold_score),
      technical_requirements: position.technical_requirements ?? '',
      max_age: Number(position.max_age ?? DEFAULT_FORM.max_age),
      min_edu: position.min_edu ?? DEFAULT_FORM.min_edu,
      min_exp: Number(position.min_exp ?? DEFAULT_FORM.min_exp),
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (saving) return;
    setDrawerOpen(false);
    setEditingPositionId(null);
    setForm(DEFAULT_FORM);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      window.alert('请输入岗位名称');
      return;
    }

    setSaving(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      location: form.location.trim(),
      technical_requirements: form.technical_requirements.trim(),
    };

    const query = editingPositionId
      ? supabase.from('active_positions').update(payload).eq('id', editingPositionId)
      : supabase.from('active_positions').insert([payload]);

    const { error } = await query;
    setSaving(false);

    if (error) {
      window.alert(`保存失败：${error.message}`);
      return;
    }

    await fetchPositions();
    if (!editingPositionId) {
      setSelectedPositionId(null);
    } else {
      setSelectedPositionId(editingPositionId);
    }
    closeDrawer();
  };

  const handleDeletePosition = async (id: string) => {
    const target = positions.find((item) => item.id === id);
    if (!target) return;

    const confirmed = window.confirm(`确认删除岗位“${target.title}”吗？`);
    if (!confirmed) return;

    setDeletingId(id);
    const { error } = await supabase.from('active_positions').delete().eq('id', id);
    setDeletingId(null);

    if (error) {
      window.alert(`删除失败：${error.message}`);
      return;
    }

    await fetchPositions();
  };

  return (
    <div className="min-h-full bg-[#f5f9ff]">
      <div className="space-y-6 animate-in fade-in duration-500">
        <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
          <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#426a9a]">
                    <BriefcaseBusiness className="h-3.5 w-3.5" />
                    岗位中心
                  </div>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-[#16355f]">岗位管理</h1>
                    <p className="mt-1 text-sm text-[#5d7896]">
                      先看岗位池状态，再决定哪些岗位需要新建、收紧或补充规则。                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openCreateDrawer}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#1f5fbf] px-4 py-3 text-sm font-medium text-white shadow-[0_18px_36px_-20px_rgba(31,95,191,0.9)] transition hover:bg-[#194f9e]"
                >
                  <Plus className="h-4 w-4" />
                  新建岗位
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">岗位总数</p>
                  <p className="mt-2 text-3xl font-semibold text-[#16355f]">{positions.length}</p>
                </div>
                <div className="rounded-[20px] border border-[#f1d8de] bg-[#fff6f8] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d6576]">紧急岗位</p>
                  <p className="mt-2 text-3xl font-semibold text-[#8e3550]">{urgentCount}</p>
                </div>
                <div className="rounded-[20px] border border-[#d8e4f4] bg-white p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">平均阈值</p>
                  <p className="mt-2 text-3xl font-semibold text-[#16355f]">{averageThreshold || '--'}</p>
                </div>
                <div className="rounded-[20px] border border-[#f5e4c8] bg-[#fffaf1] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9b7a45]">待优化岗位</p>
                  <p className="mt-2 text-3xl font-semibold text-[#7b5a22]">{highRiskCount}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
              <div className="flex items-center gap-2 text-[#24476b]">
                <ShieldAlert className="h-4 w-4" />
                <h2 className="text-sm font-semibold">当前策略提示</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[#56718f]">
                <div className="rounded-[16px] border border-[#d6e2f1] bg-white/80 p-4">
                  阈值过高、经验要求过重、描述过短，都会让筛选结果失真。                </div>
                <div className="rounded-[16px] border border-[#d6e2f1] bg-white/80 p-4">
                  先统一岗位标准，再发起筛选和面试，后续回溯成本更低。                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center justify-between border-b border-[#e4edf8] px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-[#16355f]">岗位池</h2>
                <p className="mt-1 text-sm text-[#6b86a4]">选择岗位查看规则摘要与风险提示。</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-16">
                <Loader2 className="h-8 w-8 animate-spin text-[#6b86a4]" />
              </div>
            ) : positions.length === 0 ? (
              <div className="p-12">
                <div className="rounded-[24px] border border-dashed border-[#cddcf0] bg-[#f8fbff] px-6 py-14 text-center">
                  <BriefcaseBusiness className="mx-auto h-9 w-9 text-[#89a6c7]" />
                  <p className="mt-4 text-base font-medium text-[#24476b]">还没有岗位配置</p>
                  <p className="mt-2 text-sm text-[#6b86a4]">先创建一个岗位，再配置筛选门槛和技术要求。</p>
                  <button
                    type="button"
                    onClick={openCreateDrawer}
                    className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#1f5fbf] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#194f9e]"
                  >
                    <Plus className="h-4 w-4" />
                    鏂板缓宀椾綅
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 p-4 sm:p-5">
                {positions.map((position) => {
                  const isActive = position.id === selectedPosition?.id;
                  const risks = createRiskSummary(position);
                  return (
                    <button
                      key={position.id}
                      type="button"
                      onClick={() => setSelectedPositionId(position.id)}
                      className={`group rounded-[24px] border p-5 text-left transition ${
                        isActive
                          ? 'border-[#86aee7] bg-[#f7fbff] shadow-[0_14px_32px_-28px_rgba(21,53,102,0.18)]'
                          : 'border-[#dde8f5] bg-white hover:border-[#aac6ea] hover:bg-[#fbfdff]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                statusToneMap[position.status] ?? 'text-slate-700 bg-slate-100 border-slate-200'
                              }`}
                            >
                              {position.status || '未标记'}
                            </span>
                            <span className="rounded-full border border-[#d7e5f7] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5d7896]">
                              {position.department || '未分配部门'}
                            </span>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-[#16355f]">{position.title || '未命名岗位'}</h3>
                            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#6b86a4]">
                              <MapPin className="h-3.5 w-3.5" />
                              {position.location || '地点未填写'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditDrawer(position);
                            }}
                            className="rounded-xl border border-[#d7e5f7] bg-white p-2 text-[#4a688d] transition hover:border-[#aac6ea] hover:text-[#16355f]"
                          >
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeletePosition(position.id);
                            }}
                            disabled={deletingId === position.id}
                            className="rounded-xl border border-[#f0d5dc] bg-white p-2 text-[#a2506a] transition hover:border-[#d8a8b6] hover:text-[#842645] disabled:opacity-60"
                          >
                            {deletingId === position.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-[18px] border border-[#dde8f5] bg-white/85 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">推荐阈值</p>
                          <p className="mt-2 text-xl font-semibold text-[#16355f]">{position.threshold_score}</p>
                        </div>
                        <div className="rounded-[18px] border border-[#dde8f5] bg-white/85 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">瀛﹀巻闂ㄦ</p>
                          <p className="mt-2 text-base font-semibold text-[#16355f]">{position.min_edu}及以上</p>
                        </div>
                        <div className="rounded-[18px] border border-[#dde8f5] bg-white/85 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">经验门槛</p>
                          <p className="mt-2 text-base font-semibold text-[#16355f]">{position.min_exp} 年以上</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <p className="line-clamp-2 max-w-[80%] text-sm leading-6 text-[#5d7896]">
                          {position.technical_requirements || '暂未填写技术要求'}
                        </p>
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-[#3d6597]">
                          查看详情
                          <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                        </span>
                      </div>

                      {risks.length > 0 && (
                        <div className="mt-4 rounded-[18px] border border-[#f5e4c8] bg-[#fff9f1] px-3 py-2 text-xs text-[#8c6932]">
                          风险：{risks[0]}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
              <div className="border-b border-[#e4edf8] px-6 py-5">
                <h2 className="text-lg font-semibold text-[#16355f]">岗位摘要</h2>
              </div>

              {selectedPosition ? (
                <div className="space-y-5 px-6 py-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          statusToneMap[selectedPosition.status] ?? 'text-slate-700 bg-slate-100 border-slate-200'
                        }`}
                      >
                        {selectedPosition.status || '未标记'}
                      </span>
                      <span className="rounded-full border border-[#d7e5f7] bg-[#f8fbff] px-2.5 py-1 text-[11px] font-semibold text-[#5d7896]">
                        {selectedPosition.department || '未分配部门'}
                      </span>
                    </div>
                    <h3 className="mt-3 text-2xl font-semibold text-[#16355f]">{selectedPosition.title}</h3>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[#6b86a4]">
                      <MapPin className="h-3.5 w-3.5" />
                      {selectedPosition.location || '地点未填写'}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-[#dde8f5] bg-[#f8fbff] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">推荐阈值</p>
                      <p className="mt-2 text-2xl font-semibold text-[#16355f]">{selectedPosition.threshold_score}</p>
                    </div>
                    <div className="rounded-[20px] border border-[#dde8f5] bg-[#f8fbff] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">筛选边界</p>
                      <p className="mt-2 text-sm font-medium text-[#16355f]">
                        {selectedPosition.min_edu} / {selectedPosition.min_exp} 年 / {selectedPosition.max_age} 岁内
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-[#dde8f5] bg-white p-4">
                    <div className="flex items-center gap-2 text-[#24476b]">
                      <Sparkles className="h-4 w-4" />
                      <h4 className="text-sm font-semibold">规则重点</h4>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedHighlights.length > 0 ? (
                        selectedHighlights.map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-[#d7e5f7] bg-[#f7fbff] px-3 py-1.5 text-xs font-medium text-[#355b87]"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-[#6b86a4]">当前还没有明确的技术要求摘要。</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-[#f0d8dd] bg-[#fff7f8] p-4">
                    <div className="flex items-center gap-2 text-[#8f3b58]">
                      <AlertTriangle className="h-4 w-4" />
                      <h4 className="text-sm font-semibold">椋庨櫓鎻愮ず</h4>
                    </div>
                    <div className="mt-4 space-y-2">
                      {selectedRisks.length > 0 ? (
                        selectedRisks.map((risk) => (
                          <div key={risk} className="rounded-2xl border border-[#f1d8de] bg-white/70 px-3 py-2 text-sm text-[#7a4a5b]">
                            {risk}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[#6f6f7a]">当前配置没有明显的结构性风险。</p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEditDrawer(selectedPosition)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#c7daf6] bg-[#f4f8ff] px-4 py-3 text-sm font-medium text-[#24476b] transition hover:bg-[#e9f1ff]"
                  >
                    <PencilLine className="h-4 w-4" />
                    编辑当前岗位
                  </button>
                </div>
              ) : (
                <div className="px-6 py-12 text-center text-sm text-[#6b86a4]">选择一个岗位后，这里会显示规则摘要。</div>
              )}
            </section>
          </aside>
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex justify-end bg-[#09172b]/25 backdrop-blur-[2px]">
            <button type="button" aria-label="关闭抽屉" className="h-full flex-1 cursor-default" onClick={closeDrawer} />
            <div className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[#d5e2f1] bg-white shadow-[0_12px_60px_-24px_rgba(9,23,43,0.45)]">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e4edf8] bg-white/95 px-6 py-5 backdrop-blur">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">岗位编辑器</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#16355f]">
                    {editingPositionId ? '编辑岗位' : '新建岗位'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-xl border border-[#d7e5f7] p-2 text-[#4a688d] transition hover:border-[#aac6ea] hover:text-[#16355f]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-6 px-6 py-6">
                <section className="rounded-[24px] border border-[#dde8f5] bg-[#f8fbff] p-5">
                  <h3 className="text-sm font-semibold text-[#24476b]">基础信息</h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 sm:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">岗位名称</span>
                      <input
                        type="text"
                        value={form.title}
                        onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                        className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        placeholder="例如：高级云原生架构师"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">所属部门</span>
                      <select
                        value={form.department}
                        onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
                        className="w-full appearance-none rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                      >
                        {DEPARTMENTS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">状态</span>
                      <select
                        value={form.status}
                        onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                        className="w-full appearance-none rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                      >
                        {STATUSES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 sm:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">工作地点</span>
                      <input
                        type="text"
                        value={form.location}
                        onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                        className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        placeholder="例如：北京 / 杭州 / 可远程"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-[24px] border border-[#dde8f5] bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[#24476b]">筛选门槛</h3>
                    <span className="rounded-full border border-[#d7e5f7] bg-[#f8fbff] px-3 py-1 text-xs font-semibold text-[#355b87]">
                      推荐阈值 {form.threshold_score}
                    </span>
                  </div>

                  <div className="mt-5 space-y-5">
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">技术要求</span>
                      <textarea
                        rows={6}
                        value={form.technical_requirements}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, technical_requirements: event.target.value }))
                        }
                        className="w-full resize-none rounded-[20px] border border-[#d7e5f7] bg-[#fbfdff] px-4 py-3 text-sm leading-6 text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        placeholder="填写核心技术栈、项目规模、架构复杂度、性能要求等。"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">推荐阈值</span>
                      <input
                        type="range"
                        min="50"
                        max="95"
                        step="5"
                        value={form.threshold_score}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, threshold_score: Number(event.target.value) }))
                        }
                        className="w-full accent-[#1f5fbf]"
                      />
                      <div className="flex justify-between text-[11px] text-[#6b86a4]">
                        <span>50 宽松</span>
                        <span>80 标准</span>
                        <span>95 严格</span>
                      </div>
                    </label>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">最低学历</span>
                        <select
                          value={form.min_edu}
                          onChange={(event) => setForm((prev) => ({ ...prev, min_edu: event.target.value }))}
                          className="w-full appearance-none rounded-2xl border border-[#d7e5f7] bg-[#fbfdff] px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        >
                          {EDUCATION_OPTIONS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">年龄上限</span>
                        <input
                          type="number"
                          min="20"
                          max="60"
                          value={form.max_age}
                          onChange={(event) => setForm((prev) => ({ ...prev, max_age: Number(event.target.value) }))}
                          className="w-full rounded-2xl border border-[#d7e5f7] bg-[#fbfdff] px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">最低经验</span>
                        <input
                          type="number"
                          min="0"
                          max="25"
                          value={form.min_exp}
                          onChange={(event) => setForm((prev) => ({ ...prev, min_exp: Number(event.target.value) }))}
                          className="w-full rounded-2xl border border-[#d7e5f7] bg-[#fbfdff] px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                        />
                      </label>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] border border-[#f0d8dd] bg-[#fff7f8] p-5">
                  <div className="flex items-center gap-2 text-[#8f3b58]">
                    <AlertTriangle className="h-4 w-4" />
                    <h3 className="text-sm font-semibold">保存前提醒</h3>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-[#7a4a5b]">
                    {createRiskSummary(form).length > 0 ? (
                      createRiskSummary(form).map((risk) => (
                        <div key={risk} className="rounded-2xl border border-[#f1d8de] bg-white/75 px-3 py-2">
                          {risk}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-[#f1d8de] bg-white/75 px-3 py-2">
                        当前配置没有明显的结构性风险。                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-[#e4edf8] bg-white/95 px-6 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-2xl border border-[#d7e5f7] px-4 py-3 text-sm font-medium text-[#4a688d] transition hover:border-[#aac6ea] hover:text-[#16355f]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#1f5fbf] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#194f9e] disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? '保存中...' : editingPositionId ? '保存修改' : '创建岗位'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
