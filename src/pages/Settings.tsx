import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Circle, Shield, SlidersHorizontal, Users2 } from 'lucide-react';
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
];

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

    void fetchSettings();
  }, []);

  const updateSetting: SettingsCenterContextValue['updateSetting'] = async (field, value) => {
    if (!settings?.id) return;
    const settingsId = settings.id as string;
    setSyncError(null);
    setSettings((prev: any) => (prev ? { ...prev, [field]: value } : prev));

    const { error } = await supabase.from('company_settings').update({ [field]: value }).eq('id', settingsId);

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
    <div className="space-y-4 pb-16 animate-in fade-in duration-300">
      <section className="overflow-hidden rounded-[28px] border border-[#d9e5f2] bg-white px-6 py-5 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#bfd5f5] bg-[#f7fbff] px-3 py-1 text-[11px] font-semibold tracking-wide text-[#1f5fbf]">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              系统中心
            </div>
            <div>
              <h2 className="text-[28px] font-semibold leading-none tracking-tight text-[#16355f]">系统设置</h2>
              <p className="mt-2 text-sm text-[#6b86a4]">管理组织规则、AI 策略、权限治理和环境级操作。</p>
            </div>
          </div>

          <div className="inline-flex items-center gap-3 self-start rounded-2xl border border-[#d9e5f2] bg-[#fbfdff] px-4 py-3 lg:self-auto">
            <Circle
              className={`h-2.5 w-2.5 fill-current ${
                syncError ? 'text-rose-500' : loading ? 'text-slate-400' : 'text-[#1f5fbf]'
              }`}
            />
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#8aa0ba]">云端同步状态</p>
              <p className={`mt-1 text-sm font-medium ${syncError ? 'text-rose-500' : 'text-[#16355f]'}`}>
                {syncError ? '同步异常' : loading ? '同步中' : '实时生效'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-[#d9e5f2] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <nav className="hide-scrollbar flex gap-2 overflow-x-auto border-b border-[#e8eff7] px-4 py-3">
          {SETTINGS_NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 whitespace-nowrap rounded-[16px] px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border border-[#bfd5f5] bg-[#f7fbff] text-[#1f5fbf]'
                    : 'border border-transparent text-[#6b86a4] hover:border-[#e2ebf6] hover:bg-[#fbfdff] hover:text-[#16355f]'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-6">
          <Outlet context={outletContext} />
        </div>
      </section>
    </div>
  );
}
