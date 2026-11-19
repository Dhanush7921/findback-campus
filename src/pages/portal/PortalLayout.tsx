import { Bell, ClipboardList, Clock3, FileText, LogOut, PackageCheck, PencilLine, RefreshCw, Sparkles, LayoutDashboard } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { StatusBadge } from '../../components/status';
import { Button, ErrorState, PageSkeleton } from '../../components/ui';
import { ApiError, apiGet } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { clearSession, getSession } from '../../lib/session';
import { PortalCtx, type PortalData } from './context';

export default function PortalLayout() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const session = getSession('student');

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await apiGet<PortalData>('/api/portal', { auth: 'student' }));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) nav('/track', { replace: true });
      else setError(err.message);
    }
  }, [nav]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15000);
    const onVis = () => { if (document.visibilityState === 'visible' && getSession('student')) void reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onVis); };
  }, [reload]);

  if (!session) return <Navigate to="/track" replace />;
  if (error && !data) return <div className="safe-x mx-auto max-w-3xl py-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <PageSkeleton />;

  const signOut = () => { clearSession('student'); nav('/track', { replace: true }); };
  const minsLeft = Math.max(0, Math.round((session.expiresAt - now) / 60000));
  const tabs = [
    ['', t('portal.dashboard'), LayoutDashboard],
    ['details', t('portal.details'), FileText],
    ['timeline', t('portal.timeline'), Clock3],
    ['matches', t('portal.matches'), Sparkles, data.matches.length],
    ['updates', t('portal.notifications'), Bell],
    ['edit', t('portal.update'), PencilLine],
    ['collection', t('portal.collection'), PackageCheck],
  ] as const;

  return (
    <PortalCtx.Provider value={{ data, reload }}>
      <div className="safe-x mx-auto max-w-6xl py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-rise">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-teal-700"><ClipboardList className="h-4 w-4" /> {t('portal.title')}</p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-extrabold sm:text-3xl">
              <span className="font-mono tracking-wide">{data.complaint.complaintId}</span>
              <StatusBadge status={data.complaint.status} />
            </h1>
            <p className="mt-1 text-sm text-ink-500">{data.complaint.itemName}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-500">{t('portal.sessionEnds')}: {minsLeft} min</span>
            <Button variant="ghost" size="sm" onClick={() => void reload()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="secondary" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> {t('common.signout')}</Button>
          </div>
        </div>
        <nav className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Complaint sections">
          <div className="flex min-w-max gap-1 rounded-2xl border border-silver-100 bg-white p-1.5 shadow-sm">
            {tabs.map(([to, label, Icon, count]) => (
              <NavLink key={to} to={to} end={to === ''} className={({ isActive }) => `flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${isActive ? 'brand-gradient text-white shadow' : 'text-ink-500 hover:bg-silver-50 hover:text-ink-900'}`}>
                <Icon className="h-4 w-4" aria-hidden /> {label}
                {count ? <span className="rounded-full bg-white/90 px-1.5 text-xs text-teal-800 ring-1 ring-teal-200">{count}</span> : null}
              </NavLink>
            ))}
          </div>
        </nav>
        <Outlet />
      </div>
    </PortalCtx.Provider>
  );
}
