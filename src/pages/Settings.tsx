import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Circle,
  Sparkles,
  Shield,
  SlidersHorizontal,
  Users2,
  CreditCard,
  TriangleAlert,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { SettingsCenterContextValue } from './settings/context';

type SettingsNavItem = {
  key: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
};

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { key: 'organization', label: '组织规则', path: '/settings/organization', icon: Shield },
  { key: 'ai-policy', label: 'AI 与筛选策略', path: '/settings/ai-policy', icon: SlidersHorizontal },
  { key: 'access', label: '权限与成员', path: '/settings/access', icon: Users2, superAdminOnly: true },
  { key: 'billing', label: '计费与配额', path: '/settings/billing', icon: CreditCard },
  { key: 'danger', label: '危险操作', path: '/settings/danger', icon: TriangleAlert },
] as const;

export default function SettingsCenter() {
  const { isSuperAdmin } = useAuth();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      setLoading(true);
      setSyncError(null);
      const { data, error } = await supabase.from('company_settings').select('*').single();
      if (error) {
        setSyncError(error.message);
      } else if (data) {
        setSettings(data);
      }
      setLoading(false);
    }

    fetchSettings();
  }, []);

  const updateSetting: SettingsCenterContextValue['updateSetting'] = async (field, value) => {
    if (!settings?.id) return;
    const settingsId = settings.id as string;
    setSyncError(null);
    setSettings((prev: any) => (prev ? { ...prev, [field]: value } : prev));

    const { error } = await supabase
      .from('company_settings')
      .update({ [field]: value })
      .eq('id', settingsId);

    if (error) {
      setSyncError(error.message);
      const { data } = await supabase.from('company_settings').select('*').single();
      if (data) setSettings(data);
    }
  };

  const updateSettings: SettingsCenterContextValue['updateSettings'] = async (patch) => {
    if (!settings?.id) return;
    const settingsId = settings.id as string;
    setSyncError(null);
    setSettings((prev: any) => (prev ? { ...prev, ...patch } : prev));

    const { error } = await supabase.from('company_settings').update(patch).eq('id', settingsId);

    if (error) {
      setSyncError(error.message);
      const { data } = await supabase.from('company_settings').select('*').single();
      if (data) setSettings(data);
    }
  };

  const outletContext: SettingsCenterContextValue = {
    settings,
    loading,
    syncError,
    updateSetting,
    updateSettings,
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in fade-in duration-300">
      <section className="relative overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm">
        <div className="absolute -top-20 -right-20 h-52 w-52 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-primary/8 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-[11px] font-semibold tracking-wide text-primary mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              CONTROL HUB
            </div>
            <h2 className="text-[28px] leading-none font-semibold tracking-tight text-on-surface">系统设置</h2>
            <p className="text-sm text-on-surface-variant mt-3 max-w-2xl">
              管理组织规则、策略参数、权限治理和环境级操作。
            </p>
          </div>

          <div className="rounded-xl border border-outline-variant/20 bg-surface/90 px-4 py-3 min-w-[170px]">
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/70">云端同步状态</p>
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium">
              <Circle className={`w-2.5 h-2.5 fill-current ${syncError ? 'text-error' : loading ? 'text-on-surface-variant' : 'text-primary'}`} />
              <span className={syncError ? 'text-error' : 'text-on-surface'}>
                {syncError ? '同步异常' : loading ? '同步中' : '实时生效'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <nav className="flex gap-2 overflow-x-auto hide-scrollbar rounded-xl border border-outline-variant/20 bg-surface-container-low p-1">
        {SETTINGS_NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              `whitespace-nowrap px-4 py-2.5 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 ${
                isActive
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={outletContext} />
    </div>
  );
}
