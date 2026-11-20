import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, Notice, PageHeader, PageSkeleton, fmtDate } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { Table, useStaffGet, type R } from './common';

export default function Handovers() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ ready: R[]; recent: R[] }>('/api/staff/handovers');
  const [active, setActive] = useState<R | null>(null);
  const [issued, setIssued] = useState<{ handoverId: string; code: string; expiresAt: string } | null>(null);
  const [release, setRelease] = useState<R | null>(null);
  const [checked, setChecked] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const submit = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await apiPost<{ handoverId: string; code: string; expiresAt: string }>('/api/staff/handovers', { claimId: active.claim_id }, { auth: 'staff' });
      setIssued(r);
      toast('Single-use receiver code created');
      await reload();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  const complete = async () => {
    if (!release) return;
    setBusy(true);
    try {
      await apiPost(`/api/staff/handovers/${release.handover_id}/complete`, { receiverIdChecked: checked, notes }, { auth: 'staff' });
      toast('Receiver and staff confirmations recorded — item marked Returned');
      setRelease(null); setChecked(false); setNotes('');
      await reload();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Receiver-confirmed handover" lead="Issue a short-lived code, wait for the verified receiver’s digital acknowledgment, then physically check and release the item." />
      <Card className="mb-6 overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Ready for collection</h2>
        {!data.ready.length ? <EmptyState title="Nothing waiting for collection" /> : (
          <Table head={['Claim', 'Complaint', 'Item', 'Approved by', '']}>
            {data.ready.map((c) => (
              <tr key={c.claim_id}>
                <td className="px-4 py-3 font-mono">{c.claim_id}</td>
                <td className="px-4 py-3"><Link className="font-mono text-teal-700 hover:underline" to={`/staff/complaints/${c.complaint_id}`}>{c.complaint_id}</Link></td>
                <td className="px-4 py-3"><Link className="font-mono text-teal-700 hover:underline" to={`/staff/inventory/${c.item_id}`}>{c.item_id}</Link></td>
                <td className="px-4 py-3 text-xs">{c.reviewed_by}<br />{fmtDate(c.reviewed_at)}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => { setActive(c); setIssued(null); }}>Start handover</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Recent handovers</h2>
        <Table head={['Handover', 'Complaint', 'Receiver', 'State', 'Approved / released', '']} empty={!data.recent.length}>
          {data.recent.map((h) => (
            <tr key={h.handover_id}>
              <td className="px-4 py-3 font-mono">{h.handover_id}</td>
              <td className="px-4 py-3 font-mono">{h.complaint_id}</td>
              <td className="px-4 py-3">{h.receiver_name || 'Awaiting receiver'} {h.receiver_id_checked === 'true' && <span className="chip bg-emerald-100 text-emerald-800">ID checked</span>}</td>
              <td className="px-4 py-3"><span className="chip bg-silver-50 text-ink-700">{h.state || 'Legacy returned'}</span></td>
              <td className="px-4 py-3 text-xs">{h.approved_by}<br />{h.handed_over_by}</td>
              <td className="px-4 py-3 text-right">{h.state === 'receiver_confirmed' && <Button size="sm" onClick={() => { setRelease(h); setChecked(false); setNotes(''); }}>Verify & release</Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!active} onClose={() => { setActive(null); setIssued(null); }} title="Start secure handover">
        <div className="space-y-4">
          {!issued ? <><Notice tone="info">Generate a one-time code and show it to the person physically collecting the item. They must sign in with phone OTP and confirm the digital receipt.</Notice><Button className="w-full" loading={busy} onClick={submit}>Generate receiver code</Button></> : <><Notice tone="warn">Show this code only to the receiver at the counter. It expires at {fmtDate(issued.expiresAt)} and cannot be replayed.</Notice><div className="rounded-2xl bg-ink-900 p-6 text-center font-mono text-4xl font-extrabold tracking-[.3em] text-white">{issued.code}</div><p className="text-center font-mono text-xs text-ink-500">{issued.handoverId}</p><Button variant="secondary" className="w-full" onClick={() => { setActive(null); setIssued(null); }}>Done — wait for receiver confirmation</Button></>}
        </div>
      </Modal>
      <Modal open={!!release} onClose={() => setRelease(null)} title="Final staff release">
        <div className="space-y-4"><Notice tone="success">The receiver has confirmed the digital receipt. Complete the physical identity check before releasing the item.</Notice><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I physically checked the actual receiver and confirm the item is being released now.</label><Field label="Release notes" optionalLabel="optional">{(fid) => <Input id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field><Button className="w-full" disabled={!checked} loading={busy} onClick={complete}>Confirm physical release</Button></div>
      </Modal>
    </>
  );
}
