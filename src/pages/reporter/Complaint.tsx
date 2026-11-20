import { CheckCircle2, Clock3, KeyRound, MessageSquareText, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { StatusBadge } from '../../components/status';
import { Button, Card, ErrorState, Field, Input, Notice, PageSkeleton, Textarea, fmtDate } from '../../components/ui';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { getSession } from '../../lib/session';

interface Detail {
  complaint: { complaintId: string; itemName: string; status: string; category: string; description: string; lastSeenLocation: string; lostDate: string; createdAt: string };
  timeline: { status: string; at: string; message: string }[];
  notifications: { id: string; type: string; message: string; at: string }[];
  matches: { itemId: string; note: string; item: { itemName?: string; description?: string; foundLocation?: string; foundDate?: string }; claimStatus: string | null }[];
  handovers: { handoverId: string; state: string; createdAt: string; receiverConfirmedAt: string; staffConfirmedAt: string }[];
  identityStatus: string;
}

export default function ReporterComplaint() {
  const session = getSession('reporter');
  const sessionToken = session?.token;
  const { id = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimEvidence, setClaimEvidence] = useState<Record<string, string>>({});
  const [handover, setHandover] = useState({ code: '', receiverName: session?.meta?.name ?? '', acknowledgment: '', ownerAuthorization: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiGet<Detail>(`/api/v2/complaints/${id}`, { auth: 'reporter' }).then(setData).catch((e: ApiError) => setError(e.message)), [id]);
  useEffect(() => { if (sessionToken) void load(); }, [load, sessionToken]);
  if (!session) return <Navigate to="/" replace />;
  if (error) return <div className="safe-x mx-auto max-w-4xl py-16"><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <PageSkeleton />;
  const activeHandover = data.handovers.find((h) => h.state === 'challenge_issued');
  async function claim(itemId: string) {
    setBusy(true);
    try { await apiPost(`/api/v2/complaints/${id}/claim`, { itemId, evidence: claimEvidence[itemId] ?? '' }, { auth: 'reporter' }); await load(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!activeHandover) return;
    setBusy(true);
    try { await apiPost(`/api/v2/handovers/${activeHandover.handoverId}/confirm`, handover, { auth: 'reporter', timeoutMs: 60000 }); await load(); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className="safe-x mx-auto max-w-5xl py-8 sm:py-12">
      <Link to="/dashboard" className="text-sm font-semibold text-teal-700">← Back to my complaints</Link>
      <header className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono text-sm text-ink-500">{data.complaint.complaintId}</p><h1 className="text-3xl font-extrabold">{data.complaint.itemName}</h1><p className="mt-1 text-sm text-ink-500">{data.identityStatus}</p></div><StatusBadge status={data.complaint.status} /></header>
      {activeHandover && <Card className="mt-6 border-teal-200 p-6"><div className="flex items-start gap-3"><KeyRound className="h-6 w-6 text-teal-700" /><div><h2 className="font-bold">Receiver confirmation required</h2><p className="mt-1 text-sm text-ink-500">At the collection counter, enter the single-use code given by staff and confirm the digital receipt. The item is not Returned until staff also confirms physical release.</p></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="6-digit handover code" required>{(fid) => <Input id={fid} value={handover.code} onChange={(e) => setHandover((v) => ({ ...v, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" className="font-mono text-xl tracking-[.3em]" />}</Field><Field label="Actual receiver name" required>{(fid) => <Input id={fid} value={handover.receiverName} onChange={(e) => setHandover((v) => ({ ...v, receiverName: e.target.value }))} />}</Field><Field label="Digital receipt acknowledgment" required className="sm:col-span-2">{(fid) => <Textarea id={fid} value={handover.acknowledgment} onChange={(e) => setHandover((v) => ({ ...v, acknowledgment: e.target.value }))} placeholder="I confirm that I am receiving the item described in this complaint." />}</Field><Field label="Owner authorization" optionalLabel="proxy collection only" className="sm:col-span-2">{(fid) => <Textarea id={fid} value={handover.ownerAuthorization} onChange={(e) => setHandover((v) => ({ ...v, ownerAuthorization: e.target.value }))} />}</Field></div><Button className="mt-4 w-full sm:w-auto" loading={busy} disabled={handover.code.length !== 6 || handover.receiverName.trim().length < 2 || handover.acknowledgment.trim().length < 10} onClick={confirm}>Confirm digital receipt</Button></Card>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-6"><Card className="p-6"><h2 className="font-bold">Complaint details</h2><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-ink-500">Category</dt><dd className="font-semibold">{data.complaint.category}</dd></div><div><dt className="text-ink-500">Lost date</dt><dd className="font-semibold">{fmtDate(data.complaint.lostDate)}</dd></div><div className="sm:col-span-2"><dt className="text-ink-500">Last seen</dt><dd className="font-semibold">{data.complaint.lastSeenLocation}</dd></div><div className="sm:col-span-2"><dt className="text-ink-500">Description</dt><dd>{data.complaint.description}</dd></div></dl></Card>
        <Card className="p-6"><h2 className="font-bold">Approved potential matches</h2>{!data.matches.length ? <p className="mt-3 text-sm text-ink-500">No approved matches yet.</p> : <div className="mt-4 space-y-4">{data.matches.map((m) => <div key={m.itemId} className="rounded-2xl border border-silver-100 p-4"><div className="flex justify-between gap-3"><div><strong>{m.item.itemName || 'Possible match'}</strong><p className="mt-1 text-sm text-ink-500">{m.item.description}</p></div>{m.claimStatus && <span className="chip bg-amber-50 text-amber-800">{m.claimStatus}</span>}</div>{!m.claimStatus && <><Textarea className="mt-3" value={claimEvidence[m.itemId] ?? ''} onChange={(e) => setClaimEvidence((v) => ({ ...v, [m.itemId]: e.target.value }))} placeholder="Private ownership evidence" /><Button size="sm" className="mt-3" onClick={() => claim(m.itemId)} loading={busy} disabled={(claimEvidence[m.itemId] ?? '').trim().length < 10}>Submit ownership claim</Button></>}</div>)}</div>}</Card></div>
        <div className="space-y-6"><Card className="p-6"><h2 className="flex items-center gap-2 font-bold"><Clock3 className="h-5 w-5 text-teal-700" /> Progress timeline</h2><ol className="mt-4 space-y-4">{data.timeline.map((t, i) => <li key={`${t.status}-${t.at}`} className="flex gap-3"><div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700">{i === data.timeline.length - 1 ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-teal-500" />}</div><div><strong className="text-sm">{t.status}</strong><p className="text-xs text-ink-500">{fmtDate(t.at)}</p><p className="mt-1 text-sm text-ink-700">{t.message}</p></div></li>)}</ol></Card><Card className="p-6"><h2 className="flex items-center gap-2 font-bold"><MessageSquareText className="h-5 w-5 text-teal-700" /> Staff messages</h2>{!data.notifications.length ? <p className="mt-3 text-sm text-ink-500">No messages yet.</p> : <div className="mt-3 space-y-3">{data.notifications.slice(0, 10).map((n) => <div key={n.id} className="rounded-xl bg-silver-50 p-3 text-sm"><p>{n.message}</p><small className="text-ink-500">{fmtDate(n.at)}</small></div>)}</div>}<Notice tone="info" className="mt-4"><ShieldCheck className="mr-1 inline h-4 w-4" /> Private identifying details are never shown in the public found-item view.</Notice></Card></div>
      </div>
    </div>
  );
}
