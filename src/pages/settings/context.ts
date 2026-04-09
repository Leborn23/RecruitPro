import { useOutletContext } from 'react-router-dom';

export interface SettingsCenterContextValue {
  settings: any;
  loading: boolean;
  syncError: string | null;
  updateSetting: (field: string, value: any) => Promise<void>;
  updateSettings: (patch: Record<string, any>) => Promise<void>;
}

export function useSettingsCenterContext() {
  return useOutletContext<SettingsCenterContextValue>();
}
