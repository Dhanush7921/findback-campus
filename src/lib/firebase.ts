import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import type { PublicConfig } from './config';

export function phoneAuth(config: PublicConfig): Auth {
  const c = config.reporterAuth;
  if (!c.enabled || !c.projectId || !c.apiKey || !c.authDomain) throw new Error('Phone OTP is not configured.');
  const app = getApps().length ? getApp() : initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId || undefined });
  return getAuth(app);
}
