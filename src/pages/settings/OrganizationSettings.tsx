import type { ComponentType } from 'react';
import { FileCode2, Shield, ShieldAlert, ClipboardCheck } from 'lucide-react';
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
    title: 'GitHub 开源项目纳入评分',
    desc: '候选人有公开仓库时，系统将仓库信息纳入筛选参考。',
    icon: FileCode2,
  },
  {
    field: 'resume_privacy',
    title: '候选人联系方式脱敏',
    desc: '在进入约面阶段前，手机号与邮箱默认不可见。',
    icon: ShieldAlert,
  },
  {
    field: 'mandatory_feedback',
    title: '面试反馈结构化必填',
    desc: '面试官提交评价时，必须填写结构化复盘项。',
    icon: ClipboardCheck,
  },
];

export default function OrganizationSettings() {
  const { settings, loading, syncError, updateSetting } = useSettingsCenterContext();

  if (loading) {
    return <div className="p-12 text-center text-on-surface-variant animate-pulse">正在同步组织配置...</div>;
  }

  const enabledCount = RULES.filter((rule) => settings?.[rule.field] === true).length;

  return (
    <section className="relative overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm">
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
      <div className="relative space-y-5">
        <h3 className="text-base font-medium text-on-surface flex items-center gap-2 border-b border-outline-variant/10 pb-4">
          <Shield className="w-5 h-5 text-primary" /> 组织规则
        </h3>

        <div className="rounded-lg border border-primary/20 bg-primary/6 px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">当前启用规则</p>
          <p className="text-sm font-semibold text-primary">
            {enabledCount} / {RULES.length}
          </p>
        </div>

        {syncError && (
          <div className="rounded-lg border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">
            设置同步失败：{syncError}
          </div>
        )}

        <div className="space-y-3">
          {RULES.map((rule) => {
            const isOn = settings?.[rule.field] === true;
            const Icon = rule.icon;
            return (
              <article
                key={rule.field}
                className={`rounded-lg border p-4 transition-colors ${
                  isOn
                    ? 'border-primary/25 bg-primary/5'
                    : 'border-outline-variant/15 bg-surface hover:border-primary/30'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                        isOn ? 'bg-primary/15 text-primary' : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-on-surface">{rule.title}</h4>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            isOn
                              ? 'border-primary/20 text-primary bg-primary/8'
                              : 'border-outline-variant/20 text-on-surface-variant bg-surface-container-low'
                          }`}
                        >
                          {isOn ? '已启用' : '未启用'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{rule.desc}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting(rule.field, !isOn)}
                    className={`w-11 h-6 rounded-full relative cursor-pointer border transition-colors flex items-center shrink-0 ${
                      isOn ? 'bg-primary border-primary' : 'bg-surface-container-high border-outline-variant/20'
                    }`}
                    aria-pressed={isOn}
                    aria-label={rule.title}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
                        isOn ? 'translate-x-[24px]' : 'translate-x-[4px] bg-on-surface-variant'
                      }`}
                    />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
