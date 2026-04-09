import { useState } from 'react';
import { TriangleAlert, ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function DangerSettings() {
  const [confirmText, setConfirmText] = useState('');
  const canExecute = confirmText.trim().toUpperCase() === 'RESET';

  const handleReset = () => {
    if (!canExecute) return;
    window.alert('危险操作入口保留。请在后端接入审计与二次确认后启用。');
    setConfirmText('');
  };

  return (
    <section className="space-y-4">
      <article className="relative overflow-hidden rounded-xl border border-error/25 bg-error/6 p-6 shadow-sm">
        <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-error/20 blur-3xl pointer-events-none" />
        <div className="relative">
          <h3 className="text-base font-medium text-error flex items-center gap-2 border-b border-error/20 pb-4">
            <TriangleAlert className="w-5 h-5" /> 危险操作
          </h3>
          <p className="text-sm text-on-surface-variant leading-relaxed mt-4">
            该区域用于系统级不可逆操作（例如批量清理测试数据）。上线前建议接入审计日志、审批流和多次确认。
          </p>
        </div>
      </article>

      <article className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm">
        <h4 className="text-sm font-medium text-on-surface flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-error" />
          执行前检查
        </h4>
        <div className="space-y-1.5 text-xs text-on-surface-variant">
          <p>1. 操作不可撤销，执行前请备份测试数据。</p>
          <p>2. 仅建议在演示环境执行，生产环境禁止。</p>
          <p>3. 请确保相关成员知晓并确认窗口期。</p>
        </div>
      </article>

      <article className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-5 shadow-sm space-y-3">
        <p className="text-sm text-on-surface-variant">
          输入 <span className="font-semibold text-on-surface">RESET</span> 以解锁执行按钮
        </p>
        <div className="relative md:max-w-sm">
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="输入 RESET"
            className="w-full bg-surface border border-outline-variant/20 rounded-md px-4 py-2.5 pr-24 text-sm outline-none focus:border-error transition-colors"
          />
          {confirmText.length > 0 && (
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-xs ${
                canExecute ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {canExecute ? '已解锁' : '未匹配'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={!canExecute}
          className="cursor-pointer px-4 py-2 bg-error text-white rounded-md text-sm font-medium hover:bg-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          执行危险操作（占位）
        </button>
      </article>
    </section>
  );
}
