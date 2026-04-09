import { CreditCard, Activity, Users } from 'lucide-react';

export default function BillingSettings() {
  return (
    <section className="space-y-4">
      <article className="relative overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm">
        <div className="absolute -right-14 -top-16 h-44 w-44 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-on-surface flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" /> 计费与配额
            </h3>
            <p className="text-sm text-on-surface-variant mt-2">RecruitPro Pro，按调用量计费，支持坐席扩容。</p>
          </div>
          <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold text-primary">
            Pro 套餐
          </span>
        </div>
      </article>

      <div className="grid md:grid-cols-2 gap-4">
        <article className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center gap-2 text-on-surface">
            <Users className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">管理员坐席</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-on-surface">12 / 20</p>
          <div className="mt-3 h-2 rounded-full bg-surface-container overflow-hidden">
            <div className="h-full w-[60%] bg-gradient-to-r from-primary/60 to-primary" />
          </div>
        </article>

        <article className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex items-center gap-2 text-on-surface">
            <Activity className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">模型调用额度</p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-on-surface">92%</p>
          <div className="mt-3 h-2 rounded-full bg-surface-container overflow-hidden">
            <div className="h-full w-[92%] bg-gradient-to-r from-primary to-error" />
          </div>
        </article>
      </div>

      <article className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm">
        <p className="text-xs text-on-surface-variant mb-3">最近账单（示例）</p>
        <div className="rounded-lg border border-outline-variant/15 bg-surface px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-on-surface-variant">2026-03 月账单</span>
          <span className="text-sm font-semibold text-on-surface">¥ 12,800</span>
        </div>
      </article>
    </section>
  );
}
