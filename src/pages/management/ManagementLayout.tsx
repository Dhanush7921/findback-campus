import { BarChart3, FileClock, LayoutDashboard, LogOut, MapPin, Menu, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Logo } from '../../components/art';
import { Button, Card, Notice, PageSkeleton } from '../../components/ui';
import { ApiError, apiGet } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { clearSession, getSession } from '../../lib/session';
import { SignIn } from '../staff/StaffLayout';

const NAV = [
  ['', 'Executive overview', LayoutDashboard],
  ['analytics', 'Analytics & trends', BarChart3],
  ['hotspots', 'Campus hotspots', MapPin],
  ['audit', 'Audit trail', FileClock],
  ['policies', 'Policies & security', ShieldCheck],
] as const;

export default function ManagementLayout() {
  const { config, status } = useConfig();
  const nav = useNavigate();
  const loc = useLocation();
  const [session, setSession] = useState(() => getSession('staff'));
  const sessionToken = session?.token;
  const [verified, setVerified] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!sessionToken) return;
    apiGet<{ email: string; role: string }>('/api/staff/me', { auth: 'staff' }).then((r) => {
      if (!['management', 'admin'].includes(r.role)) setDenied('This account has operational staff access, not Management monitoring access.');
      else setVerified(true);
    }).catch((e: ApiError) => setDenied(e.message));
  }, [sessionToken]);
  if (status === 'loading') return <PageSkeleton />;
  if (!config?.staff.enabled && !config?.staff.devLogin) return <div className="grid min-h-dvh place-items-center safe-x"><Card className="max-w-lg p-8 text-center"><h1 className="text-2xl font-extrabold">Management access is not configured</h1><p className="mt-2 text-sm text-ink-500">Add authorised management accounts to the server-side allowlist.</p></Card></div>;
  if (!session) return <SignIn clientId={config?.staff.googleClientId ?? null} devLogin={config?.staff.devLogin} title="Management sign-in" onDone={() => setSession(getSession('staff'))} />;
  if (denied) return <div className="grid min-h-dvh place-items-center safe-x"><Card className="max-w-lg p-8"><Notice tone="error">{denied}</Notice><Button className="mt-5 w-full" variant="secondary" onClick={() => { clearSession('staff'); setSession(null); setDenied(null); }}>Use another account</Button></Card></div>;
  if (!verified) return <PageSkeleton />;
  const sidebar = <nav className="flex flex-col gap-1">{NAV.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === ''} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-teal-50 text-teal-800' : 'text-ink-500 hover:bg-silver-50'}`}><Icon className="h-[18px] w-[18px]" />{label}</NavLink>)}</nav>;
  const signOut = () => { clearSession('staff'); nav('/', { replace: true }); };
  return <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]"><aside className="hidden border-r border-silver-100 bg-white/75 p-5 lg:block"><Link to="/management" className="mb-8 block"><Logo /></Link><p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[.15em] text-teal-700">Monitoring only</p>{sidebar}</aside><div className="min-w-0"><header className="glass sticky top-0 z-30 flex h-16 items-center justify-between border-x-0 border-t-0 safe-x"><button className="lg:hidden" onClick={() => setOpen(true)}><Menu /></button><span className="text-xs font-bold uppercase tracking-[.15em] text-teal-700">Management · Read only</span><Button variant="secondary" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button></header>{open && <div className="fixed inset-0 z-50 bg-ink-900/30" onClick={() => setOpen(false)}><aside className="h-full w-72 bg-white p-5" onClick={(e) => e.stopPropagation()}><div className="mb-6 flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)}><X /></button></div>{sidebar}</aside></div>}<main className="safe-x mx-auto max-w-6xl py-8"><Outlet /></main></div></div>;
}
