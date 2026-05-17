import { useOutletContext } from 'react-router-dom';

export type SettingsRecord = Record<string, unknown> & { id?: string };

export interface SettingsCenterContextValue {
  settings: SettingsRecord | null;
  loading: boolean;
  syncError: string | null;
  updateSetting: (field: string, value: unknown) => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
}

export function useSettingsCenterContext() {
  return useOutletContext<SettingsCenterContextValue>();
}
