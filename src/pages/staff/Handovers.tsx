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
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const submit = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await apiPost('/api/staff/handovers', { claimId: active.claim_id, receiverName: name, receiverIdChecked: checked, notes }, { auth: 'staff' });
      toast('Handover recorded — complaint marked Returned');
      setActive(null); setName(''); setChecked(false); setNotes('');
      await reload();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Item handover" lead="Release items only for approved claims, after checking the receiver’s college ID in person." />
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
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => setActive(c)}>Record handover</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <h2 className="p-5 pb-0 font-bold">Recent handovers</h2>
        <Table head={['Handover', 'Complaint', 'Receiver', 'Approved / handed over', 'When']} empty={!data.recent.length}>
          {data.recent.map((h) => (
            <tr key={h.handover_id}>
              <td className="px-4 py-3 font-mono">{h.handover_id}</td>
              <td className="px-4 py-3 font-mono">{h.complaint_id}</td>
              <td className="px-4 py-3">{h.receiver_name} {h.receiver_id_checked === 'true' && <span className="chip bg-emerald-100 text-emerald-800">ID checked</span>}</td>
              <td className="px-4 py-3 text-xs">{h.approved_by}<br />{h.handed_over_by}</td>
              <td className="px-4 py-3 text-xs">{fmtDate(h.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!active} onClose={() => setActive(null)} title="Record handover">
        <div className="space-y-4">
          <Notice tone="warn">Check the college ID card matches the complaint’s student. Never ask for the PIN.</Notice>
          <Field label="Receiver full name" required>{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the receiver’s college ID card in person and it matches the complaint.</label>
          <Field label="Notes" optionalLabel="optional">{(fid) => <Input id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <Button className="w-full" disabled={!checked || name.trim().length < 2} loading={busy} onClick={submit}>Confirm handover</Button>
        </div>
      </Modal>
    </>
  );
}
