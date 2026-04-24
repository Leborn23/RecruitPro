import type { ComponentType } from 'react';
import { ClipboardCheck, FileCode2, Shield, ShieldAlert } from 'lucide-react';
import { useSettingsCenterContext } from './context';

type RuleItem = {
  field: string;
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
};

const RULES: RuleItem[] = [
  {
    field: 'ai_screening_enabled',
    title: '纳入公开代码信息',
    desc: '候选人存在公开仓库时，将仓库信息纳入筛选参考，用于补充技术判断。',
    icon: FileCode2,
  },
  {
    field: 'resume_privacy',
    title: '联系方式默认脱敏',
    desc: '在进入约面或发起联系前，手机号和邮箱默认不对普通成员展示。',
    icon: ShieldAlert,
  },
  {
    field: 'mandatory_feedback',
    title: '面试反馈必须结构化',
    desc: '面试官提交评价时，必须填写结构化结论与复盘信息，避免只留口头判断。',
    icon: ClipboardCheck,
  },
];

export default function OrganizationSettings() {
  const { settings, loading, syncError, updateSetting } = useSettingsCenterContext();

  if (loading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse">正在同步组织规则...</div>;
  }

  const enabledCount = RULES.filter((rule) => settings?.[rule.field] === true).length;

  return (
    <div className="space-y-5">
      <h3 className="flex items-center gap-2 border-b border-[#e8eff7] pb-4 text-base font-semibold text-[#16355f]">
        <Shield className="h-5 w-5 text-[#1f5fbf]" />
        组织规则
      </h3>

      <div className="flex items-center justify-between rounded-[18px] border border-[#d9e5f2] bg-[#fbfdff] px-4 py-3">
        <p className="text-xs text-[#6b86a4]">当前已启用规则</p>
        <p className="text-sm font-semibold text-[#1f5fbf]">
          {enabledCount} / {RULES.length}
        </p>
      </div>

      {syncError ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          设置同步失败：{syncError}
        </div>
      ) : null}

      <div className="space-y-3">
        {RULES.map((rule) => {
          const isOn = settings?.[rule.field] === true;
          const Icon = rule.icon;

          return (
            <article
              key={rule.field}
              className={`rounded-[20px] border p-4 transition-colors ${
                isOn ? 'border-[#bfd5f5] bg-[#f7fbff]' : 'border-[#e2ebf6] bg-white hover:border-[#c9d9eb]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-[14px] ${
                      isOn ? 'bg-[#eaf3ff] text-[#1f5fbf]' : 'bg-[#f5f8fc] text-[#6b86a4]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-[#16355f]">{rule.title}</h4>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          isOn
                            ? 'border-[#bfd5f5] bg-[#f0f7ff] text-[#1f5fbf]'
                            : 'border-[#e2ebf6] bg-[#fbfdff] text-[#6b86a4]'
                        }`}
                      >
                        {isOn ? '已启用' : '未启用'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[#6b86a4]">{rule.desc}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => updateSetting(rule.field, !isOn)}
                  className={`relative flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                    isOn ? 'border-[#1f5fbf] bg-[#1f5fbf]' : 'border-[#d5dfeb] bg-[#eef3f8]'
                  }`}
                  aria-pressed={isOn}
                  aria-label={rule.title}
                >
                  <span
                    className={`h-4 w-4 rounded-full shadow-sm transition-transform duration-300 ${
                      isOn ? 'translate-x-[24px] bg-white' : 'translate-x-[4px] bg-[#6b86a4]'
                    }`}
                  />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
