import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiConfigured, apiGet } from './api';

export interface PublicConfig {
  collectionOffice: string;
  collectionHours: string;
  contactEmail: string;
  contactPhone: string;
  submissionsOpen: boolean;
  staff: { enabled: boolean; googleClientId: string | null; devLogin?: boolean };
  reporterAuth: {
    enabled: boolean;
    projectId: string | null;
    apiKey: string | null;
    authDomain: string | null;
    appId: string | null;
  };
  turnstileSiteKey: string | null;
  environment: string;
  degraded?: boolean;
}
interface State { config: PublicConfig | null; status: 'loading' | 'ready' | 'offline' | 'unconfigured' }
const Ctx = createContext<State>({ config: null, status: 'loading' });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({ config: null, status: apiConfigured() ? 'loading' : 'unconfigured' }));
  useEffect(() => {
    if (!apiConfigured()) return;
    apiGet<PublicConfig>('/api/public/config', { retries: 2 })
      .then((config) => setState({ config, status: 'ready' }))
      .catch(() => setState({ config: null, status: 'offline' }));
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
export const useConfig = () => useContext(Ctx);
