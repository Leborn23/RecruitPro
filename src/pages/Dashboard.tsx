import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowRight, Briefcase, CalendarDays, CheckCircle2, Gauge, MapPin, UserRound } from 'lucide-react';

type PositionRow = {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  status: string | null;
};

type CandidateRow = {
  id: string;
  name: string;
  edu: string | null;
  exp: string | null;
};

type InterviewRow = {
  id: string;
  name: string;
  stage: string | null;
  position: string | null;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candidateTotalCount, setCandidateTotalCount] = useState(0);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const [posRes, canRes, candidateCountRes, intRes] = await Promise.all([
        supabase.from('active_positions').select('id,title,department,location,status').order('created_at', { ascending: false }),
        supabase.from('candidates').select('id,name,edu,exp').order('created_at', { ascending: false }).limit(6),
        supabase.from('candidates').select('id', { count: 'exact', head: true }),
        supabase.from('upcoming_interviews').select('id,name,stage,position').order('created_at', { ascending: false }).limit(8),
      ]);

      if (posRes.data) setPositions(posRes.data as PositionRow[]);
      if (canRes.data) setCandidates(canRes.data as CandidateRow[]);
      setCandidateTotalCount(candidateCountRes.count ?? 0);
      if (intRes.data) setInterviews(intRes.data as InterviewRow[]);
    };

    void fetchData();
  }, []);

  const boardStats = {
    positionCount: positions.length,
    candidateCount: candidateTotalCount,
    interviewCount: interviews.length,
    activePositionCount: positions.filter((item) => String(item.status ?? '').trim().toLowerCase() !== 'closed').length,
  };
  const formatCandidateMeta = (candidate: CandidateRow) => {
    const parts = [candidate.edu, candidate.exp].map((item) => String(item ?? '').trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '资料待完善';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-[#426a9a]">
                <Gauge className="h-3.5 w-3.5" />
                  看板总览
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-[#16355f]">招聘指挥台</h1>
                  <p className="mt-1 text-sm text-[#5d7896]">
                    先看岗位、候选人和面试节奏，再决定下一步推进动作。
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3 text-sm font-semibold text-[#355b87] shadow-[0_12px_28px_-24px_rgba(31,95,191,0.28)]">
                当前模式：统一招聘控制台
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">岗位总数</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.positionCount}</p>
              </div>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">进行中岗位</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.activePositionCount}</p>
              </div>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">候选人总数</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.candidateCount}</p>
              </div>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">近期面试</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{boardStats.interviewCount}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4 shadow-[0_16px_30px_-28px_rgba(21,53,102,0.16)]">
            <div className="flex items-center gap-2 text-[#24476b]">
              <CheckCircle2 className="h-4 w-4 text-[#1f5fbf]" />
              <h2 className="text-sm font-semibold">当前处理建议</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#56718f]">
              <div className="rounded-[16px] border border-[#d6e2f1] bg-white/80 p-4">
                优先维护岗位规则和技术要求，再看候选人匹配结果，能减少后续误筛和重复沟通。
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-white/80 p-4">
                面试安排建议结合当前高匹配候选人推进，不要在规则未稳定前过早大批量排期。
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center justify-between border-b border-[#e4edf8] px-6 py-5">
              <h3 className="text-lg font-semibold text-[#16355f]">进行中的岗位</h3>
              <button
                onClick={() => navigate('/positions')}
                className="text-sm font-medium text-[#355b87] transition hover:text-[#16355f] flex items-center gap-1 cursor-pointer"
              >
                查看全部 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            {positions.length === 0 ? (
              <div className="p-6 text-sm text-[#5d7896]">暂无岗位数据。</div>
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                {positions.map((pos) => (
                  <div
                    key={pos.id}
                    onClick={() => navigate('/positions')}
                    className="rounded-[24px] border border-[#dde8f5] bg-[#fbfdff] p-5 transition hover:border-[#aac6ea] hover:bg-white cursor-pointer group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="font-medium text-[#16355f] group-hover:text-[#1f5fbf] transition-colors">{pos.title}</h4>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border border-[#d7e5f7] bg-[#f8fbff] text-[#5d7896]">
                        {pos.status || 'open'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[#5d7896]">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5" />
                        {pos.department || '未分配部门'}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        {pos.location || '未设置地点'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center justify-between border-b border-[#e4edf8] px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-[#16355f]">最新候选人</h3>
                <p className="mt-1 text-xs text-[#6b86a4]">最近进入候选人库的简历，可进入详情查看匹配结果。</p>
              </div>
              <button
                onClick={() => navigate('/candidates')}
                className="text-sm font-medium text-[#355b87] transition hover:text-[#16355f] flex items-center gap-1 cursor-pointer"
              >
                查看全部 <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {candidates.length === 0 ? (
              <div className="p-6 text-sm text-[#5d7896]">暂无候选人数据。</div>
            ) : (
              <div className="divide-y divide-[#edf3fa]">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    onClick={() => navigate(`/candidates/${candidate.id}`)}
                    className="flex cursor-pointer items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[#f8fbff]"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#d6e2f1] bg-[#f4f8ff] font-medium text-[#1f5fbf]">
                        {candidate.name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-[15px] font-medium text-[#16355f]">{candidate.name || '未命名候选人'}</h4>
                        <p className="mt-0.5 truncate text-xs text-[#5d7896]">{formatCandidateMeta(candidate)}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#8aa2bd]" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[28px] border border-[#cddcf0] bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-[#e4edf8]">
              <CalendarDays className="w-5 h-5 text-[#6b86a4]" />
              <h3 className="text-lg font-semibold text-[#16355f]">近期面试安排</h3>
            </div>

            {interviews.length === 0 ? (
              <p className="text-sm text-[#5d7896]">暂无面试安排。</p>
            ) : (
              <div className="space-y-6">
                {interviews.map((interview) => (
                  <div
                    key={interview.id}
                    className="relative pl-6 before:content-[''] before:absolute before:left-[7px] before:top-2 before:bottom-[-24px] last:before:hidden before:w-px before:bg-outline-variant/20"
                  >
                    <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-[#f4f8ff] border-2 border-white flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1f5fbf]" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm text-[#16355f]">{interview.name}</h4>
                      <p className="text-xs font-semibold text-[#1f5fbf] mt-1 mb-1">{interview.stage || '待定阶段'}</p>
                      <p className="text-xs text-[#5d7896] flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5" />
                        {interview.position || '未关联岗位'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => navigate('/interviews')}
              className="w-full mt-8 py-2.5 rounded-xl text-sm font-medium text-[#355b87] bg-[#f4f8ff] hover:bg-[#eef5ff] transition-colors text-center border border-[#c7daf6] cursor-pointer"
            >
              查看全部面试
            </button>
          </section>

          <section className="rounded-[28px] border border-[#cddcf0] bg-[#f7fbff] p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
            <div className="flex items-center gap-2 mb-3">
              <UserRound className="w-5 h-5 text-[#6b86a4]" />
              <h3 className="text-lg font-semibold text-[#16355f]">处理建议</h3>
            </div>
            <p className="text-sm text-[#5d7896] leading-relaxed">
              优先查看新入库候选人的匹配结果。若出现“资料待完善”，建议先补齐简历解析信息，再进入面试安排。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
