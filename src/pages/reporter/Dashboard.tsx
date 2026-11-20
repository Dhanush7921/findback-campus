import { ClipboardList, LogOut, PlusCircle, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { StatusBadge } from '../../components/status';
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageSkeleton, fmtDate } from '../../components/ui';
import { ApiError, apiGet } from '../../lib/api';
import { clearSession, getSession } from '../../lib/session';

interface CaseRow { complaintId: string; createdAt: string; updatedAt: string; status: string; category: string; itemName: string; lostDate: string; lastSeenLocation: string }

export default function ReporterDashboard() {
  const nav = useNavigate();
  const session = getSession('reporter');
  const sessionToken = session?.token;
  const list = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionToken) return;
    apiGet<{ rows: CaseRow[] }>('/api/v2/complaints', { auth: 'reporter' }).then((r) => setRows(r.rows)).catch((e: ApiError) => setError(e.message));
  }, [sessionToken]);
  if (!session) return <Navigate to="/" replace />;
  if (error) return <div className="safe-x mx-auto max-w-4xl py-16"><ErrorState message={error} onRetry={() => location.reload()} /></div>;
  if (!rows) return <PageSkeleton />;
  const signOut = () => { clearSession('reporter'); nav('/', { replace: true }); };
  return (
    <div className="safe-x mx-auto max-w-6xl py-8 sm:py-12">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal-700">{session.meta?.identityStatus}</p><h1 className="mt-1 text-3xl font-extrabold">Welcome, {session.meta?.name}</h1><p className="mt-1 text-sm text-ink-500">Your verified phone: {session.meta?.phone}</p></div>
        <Button variant="secondary" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <ButtonLink to="/report" size="lg" className="min-h-28 justify-start rounded-[1.5rem] px-7 text-left text-lg"><PlusCircle className="h-7 w-7" /><span><strong className="block">SUBMIT LOST ITEM</strong><small className="font-normal text-white/80">Create a private lost-item complaint</small></span></ButtonLink>
        <Button size="lg" variant="secondary" className="min-h-28 justify-start rounded-[1.5rem] px-7 text-left text-lg" onClick={() => list.current?.scrollIntoView({ behavior: 'smooth' })}><Search className="h-7 w-7" /><span><strong className="block">TRACK MY COMPLAINT</strong><small className="font-normal text-ink-500">Open status, messages and matches</small></span></Button>
      </section>
      <Card className="mt-6 flex items-start gap-3 bg-gradient-to-r from-emerald-50 to-sky-50 p-5"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" /><p className="text-sm text-ink-700">Only complaints linked to this verified phone identity are shown. Guests are labelled <strong>Phone Verified Guest</strong>; phone verification is not proof of college membership.</p></Card>
      <div ref={list} className="mt-8 scroll-mt-24">
        <div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-teal-700">Private case portal</p><h2 className="text-2xl font-extrabold">My complaints</h2></div><span className="text-sm text-ink-500">{rows.length} total</span></div>
        {!rows.length ? <Card><EmptyState title="No complaints yet" action={<ButtonLink to="/report">Submit lost item</ButtonLink>} /></Card> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rows.map((c) => <Link key={c.complaintId} to={`/dashboard/complaints/${c.complaintId}`} className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"><div className="flex items-start justify-between gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><ClipboardList className="h-5 w-5" /></div><StatusBadge status={c.status} /></div><h3 className="mt-4 text-lg font-bold group-hover:text-teal-700">{c.itemName}</h3><p className="mt-1 font-mono text-xs text-ink-500">{c.complaintId}</p><p className="mt-4 text-sm text-ink-500">Lost {fmtDate(c.lostDate)} · {c.lastSeenLocation}</p></Link>)}</div>}
      </div>
    </div>
  );
}
