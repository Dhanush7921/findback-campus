import { Activity, BarChart3, ClipboardCheck, Handshake, Inbox, LayoutDashboard, LogOut, Menu, PackagePlus, Archive, Search, Settings, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../../components/art';
import { useToast } from '../../components/toast';
import { Button, ButtonLink, Card, Notice, PageSkeleton } from '../../components/ui';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { clearSession, getSession, saveSession } from '../../lib/session';
import { StaffCtx } from './common';

declare global {
  interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void; disableAutoSelect: () => void } } } }
}

const NAV = [
  ['', 'Dashboard', LayoutDashboard],
  ['register', 'Register found item', PackagePlus],
  ['inventory', 'Found inventory', Archive],
  ['complaints', 'Complaints', Inbox],
  ['matching', 'Matching & review', Sparkles],
  ['claims', 'Claim verification', ClipboardCheck],
  ['handovers', 'Handovers', Handshake],
  ['unclaimed', 'Unclaimed items', Search],
  ['activity', 'Activity log', Activity],
  ['analytics', 'Analytics', BarChart3],
  ['settings', 'Settings', Settings],
] as const;

export function SignIn({ clientId, devLogin, onDone, title = 'Staff sign-in' }: { clientId: string | null; devLogin?: boolean; onDone: () => void; title?: string }) {
  const btn = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchange = useCallback(async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ token: string; expiresAt: number; email: string; role: string }>(path, body);
      saveSession('staff', r.token, r.expiresAt, { email: r.email, role: r.role });
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }, [onDone]);
  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      window.google?.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => exchange('/api/staff/session', { credential: r.credential }), ux_mode: 'popup', auto_select: false });
      if (btn.current) window.google?.accounts.id.renderButton(btn.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
    };
    if (window.google) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    s.onerror = () => setError('Could not load Google sign-in. Check your connection or content blockers.');
    document.head.appendChild(s);
  }, [clientId, exchange]);
  return (
    <div className="grid min-h-dvh place-items-center safe-x">
      <Card className="w-full max-w-md p-8 text-center animate-rise">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">Use your authorised institutional Google account. Access is checked on the server for every request.</p>
        <div className="mt-6 flex justify-center" ref={btn} />
        {devLogin && <Button variant="secondary" className="mt-4 w-full" loading={busy} onClick={() => exchange('/api/staff/dev-session', { email: 'dev.admin@example.edu', role: 'admin' })}>Development sign-in (local only)</Button>}
        {error && <Notice tone="error" className="mt-5 text-left">{error}</Notice>}
        <Link to="/" className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline">← Back to FindBack</Link>
      </Card>
    </div>
  );
}

export default function StaffLayout() {
  const { config, status } = useConfig();
  const toast = useToast();
  const loc = useLocation();
  const [session, setSession] = useState(() => getSession('staff'));
  const [verified, setVerified] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const on = () => setSession(getSession('staff'));
    window.addEventListener('fb-session', on);
    return () => window.removeEventListener('fb-session', on);
  }, []);
  useEffect(() => {
    if (!session) return;
    apiGet<{ email: string; role: string }>('/api/staff/me', { auth: 'staff' })
      .then(() => setVerified(true))
      .catch((e: ApiError) => { if (e.status !== 401) toast(e.message, 'error'); setSession(getSession('staff')); });
  }, [session, toast]);

  if (status === 'loading') return <PageSkeleton />;
  const enabled = config?.staff.enabled || config?.staff.devLogin;
  if (!enabled) {
    return (
      <div className="grid min-h-dvh place-items-center safe-x">
        <Card className="max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ShieldAlert className="h-7 w-7" /></div>
          <h1 className="text-2xl font-extrabold">Staff access is not enabled</h1>
          <p className="mt-2 text-sm text-ink-500">
            {status === 'ready'
              ? 'Staff web access stays disabled until an administrator configures Google Workspace sign-in and the staff allowlist on the server. This protects student data from an unprotected dashboard.'
              : 'The FindBack service could not be reached, so staff access is unavailable right now.'}
          </p>
          <ButtonLink to="/" variant="secondary" className="mt-6">Back to FindBack</ButtonLink>
        </Card>
      </div>
    );
  }
  if (!session) return <SignIn clientId={config?.staff.googleClientId ?? null} devLogin={config?.staff.devLogin} onDone={() => setSession(getSession('staff'))} />;
  if (!verified) return <PageSkeleton />;

  const email = session.meta?.email ?? '';
  const role = (session.meta?.role as 'admin' | 'staff' | 'management') ?? 'staff';
  if (role === 'management') return <Navigate to="/management" replace />;
  const signOut = () => { window.google?.accounts.id.disableAutoSelect(); clearSession('staff'); setVerified(false); };
  const sidebar = (
    <nav className="flex flex-col gap-0.5" aria-label="Staff">
      {NAV.map(([to, label, Icon]) => (
        <NavLink key={to} to={to} end={to === ''} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-teal-50 text-teal-800' : 'text-ink-500 hover:bg-silver-50 hover:text-ink-900'}`}>
          <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <StaffCtx.Provider value={{ email, role }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="hidden border-r border-silver-100 bg-white/70 p-5 lg:block">
          <Link to="/staff" className="mb-8 block"><Logo /></Link>
          {sidebar}
        </aside>
        <div className="min-w-0">
          <header className="glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-x-0 border-t-0 safe-x" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <button className="grid h-11 w-11 place-items-center rounded-xl lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-6 w-6" /></button>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Staff console</span>
            <div className="flex items-center gap-3">
              <span className="hidden text-right text-xs sm:block"><span className="block font-semibold text-ink-900">{email}</span><span className="text-ink-500">{role}</span></span>
              <Button variant="secondary" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
            </div>
          </header>
          {open && (
            <div className="fixed inset-0 z-50 bg-ink-900/30 lg:hidden" onClick={() => setOpen(false)}>
              <aside className="h-full w-72 bg-white p-5 shadow-xl animate-fade" onClick={(e) => e.stopPropagation()}>
                <div className="mb-6 flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-6 w-6" /></button></div>
                {sidebar}
              </aside>
            </div>
          )}
          <main className="safe-x mx-auto max-w-6xl py-8 safe-bottom"><Outlet /></main>
        </div>
      </div>
    </StaffCtx.Provider>
  );
}
