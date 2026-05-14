import { MessageSquareText } from 'lucide-react';
import {
  getInterviewQuestionCountOption,
  INTERVIEW_QUESTION_COUNT_OPTIONS,
  normalizeInterviewQuestionCount,
} from '../../lib/interviewQuestionCount';
import {
  getInterviewDurationMinutesForQuestionCount,
} from '../../lib/interviewDuration';
import { useSettingsCenterContext } from './context';

const cardShadow = 'shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]';

export default function InterviewSettings() {
  const { settings, loading, syncError, updateSettings } = useSettingsCenterContext();

  if (loading) {
    return <div className="p-12 text-center text-slate-500 animate-pulse">正在加载面试配置...</div>;
  }

  const interviewQuestionCount = normalizeInterviewQuestionCount(settings?.interview_question_count);
  const questionCountOption = getInterviewQuestionCountOption(interviewQuestionCount);
  const interviewDuration = getInterviewDurationMinutesForQuestionCount(interviewQuestionCount);

  const saveInterviewSettings = async (patch: Partial<{ interview_question_count: number }>) => {
    await updateSettings(patch);
  };

  return (
    <section className="space-y-6 rounded-[28px] border border-[#d9e5f2] bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
      <div className="space-y-1 border-b border-[#e8eff7] pb-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#16355f]">
          <MessageSquareText className="h-5 w-5 text-[#1f5fbf]" />
          面试配置
        </h3>
        <p className="text-sm text-[#6b86a4]">设置候选人线上 AI 面试的默认题量和计时规则。</p>
      </div>

      {syncError ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          设置同步失败：{syncError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <article className={`rounded-[22px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">默认题目数量</p>
          <p className="mt-2 text-2xl font-semibold text-[#16355f]">{questionCountOption.value} 题</p>
          <p className="mt-1 text-xs text-[#6b86a4]">{questionCountOption.label}</p>
        </article>

        <article className={`rounded-[22px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">默认面试时长</p>
          <p className="mt-2 text-2xl font-semibold text-[#16355f]">{interviewDuration} 分钟</p>
          <p className="mt-1 text-xs text-[#6b86a4]">候选人点击开始面试后开始计时</p>
        </article>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[#16355f]">默认题目数量</label>
            <select
              value={String(interviewQuestionCount)}
              onChange={(event) =>
                void saveInterviewSettings({
                  interview_question_count: normalizeInterviewQuestionCount(event.target.value),
                })
              }
              className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
            >
              {INTERVIEW_QUESTION_COUNT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label} · {item.value} 题
                </option>
              ))}
            </select>
            <p className="text-xs text-[#6b86a4]">用于新创建的 AI 面试和候选人考场。</p>
          </div>
        </section>

        <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#16355f]">计时规则</p>
            <p className="rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f]">
              当前题量对应 {interviewDuration} 分钟
            </p>
            <p className="text-xs text-[#6b86a4]">时长由题量自动匹配；候选人点击开始面试后才开始倒计时。</p>
          </div>
        </section>
      </div>
    </section>
  );
}
