import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowRight, Briefcase, CalendarDays, CheckCircle2, MapPin, Sparkles, UserRound } from 'lucide-react';

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
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const [posRes, canRes, intRes] = await Promise.all([
        supabase.from('active_positions').select('id,title,department,location,status').order('created_at', { ascending: false }),
        supabase.from('candidates').select('id,name,edu,exp').order('created_at', { ascending: false }).limit(6),
        supabase.from('upcoming_interviews').select('id,name,stage,position').order('created_at', { ascending: false }).limit(8),
      ]);

      if (posRes.data) setPositions(posRes.data as PositionRow[]);
      if (canRes.data) setCandidates(canRes.data as CandidateRow[]);
      if (intRes.data) setInterviews(intRes.data as InterviewRow[]);
    };

    void fetchData();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <section className="bg-surface-container-low rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-primary-container/20" />
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-primary-container rounded-lg text-primary">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-on-surface-variant mb-2">AI 筛选洞察</h3>
            <p className="text-on-surface text-[15px] leading-relaxed max-w-4xl">
              系统会基于岗位要求自动完成简历提取、技能分析与匹配评分，并输出可解释结果与风险提示。
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-primary font-medium bg-primary-container/30 w-fit px-3 py-1.5 rounded-full">
              <CheckCircle2 className="w-4 h-4" />
              当前为纯 AI 自动筛选模式
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-on-surface">进行中的岗位</h3>
              <button
                onClick={() => navigate('/positions')}
                className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 cursor-pointer"
              >
                查看全部 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            {positions.length === 0 ? (
              <p className="text-sm text-on-surface-variant">暂无岗位数据。</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {positions.map((pos) => (
                  <div
                    key={pos.id}
                    onClick={() => navigate('/positions')}
                    className="bg-surface-container-lowest rounded-lg p-5 shadow-[0_12px_32px_-4px_rgba(41,52,58,0.04)] border border-outline-variant/10 hover:border-primary/20 transition-all cursor-pointer group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="font-medium text-on-surface group-hover:text-primary transition-colors">{pos.title}</h4>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant">
                        {pos.status || 'open'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-on-surface-variant">
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

          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-on-surface">AI 自动筛选候选人</h3>
              <button
                onClick={() => navigate('/candidates')}
                className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 cursor-pointer"
              >
                查看全部 <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {candidates.length === 0 ? (
              <p className="text-sm text-on-surface-variant">暂无候选人数据。</p>
            ) : (
              <div className="space-y-3">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    onClick={() => navigate(`/candidates/${candidate.id}`)}
                    className="bg-surface-container-lowest rounded-lg p-4 flex items-center justify-between shadow-[0_4px_16px_-4px_rgba(41,52,58,0.02)] hover:bg-surface-container-low transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary-container/50 flex items-center justify-center text-primary font-medium">
                        {candidate.name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <h4 className="font-medium text-[15px] text-on-surface">{candidate.name}</h4>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {(candidate.edu || '学历未知') + ' · ' + (candidate.exp || '经验未知')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/candidates/${candidate.id}`);
                      }}
                      className="text-primary bg-primary-container/20 hover:bg-primary-container/50 px-4 py-1.5 rounded-md text-sm font-medium transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      查看详情
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-[0_12px_32px_-4px_rgba(41,52,58,0.04)] h-full border border-outline-variant/5">
            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-outline-variant/15">
              <CalendarDays className="w-5 h-5 text-on-surface-variant" />
              <h3 className="text-lg font-medium text-on-surface">近期面试安排</h3>
            </div>

            {interviews.length === 0 ? (
              <p className="text-sm text-on-surface-variant">暂无面试安排。</p>
            ) : (
              <div className="space-y-6">
                {interviews.map((interview) => (
                  <div
                    key={interview.id}
                    className="relative pl-6 before:content-[''] before:absolute before:left-[7px] before:top-2 before:bottom-[-24px] last:before:hidden before:w-px before:bg-outline-variant/20"
                  >
                    <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-primary-container border-2 border-surface-container-lowest flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm text-on-surface">{interview.name}</h4>
                      <p className="text-xs font-semibold text-primary mt-1 mb-1">{interview.stage || '待定阶段'}</p>
                      <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
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
              className="w-full mt-8 py-2.5 rounded-md text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors text-center border border-outline-variant/10 cursor-pointer"
            >
              查看全部面试
            </button>
          </section>

          <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/5">
            <div className="flex items-center gap-2 mb-3">
              <UserRound className="w-5 h-5 text-on-surface-variant" />
              <h3 className="text-lg font-medium text-on-surface">处理建议</h3>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              当前系统为纯 AI 自动筛选。建议优先完善岗位结构化要求和简历文本提取质量，以提升匹配准确率。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
