import { useState } from 'react';
import { Card, ErrorState, PageHeader, Select, Skeleton, fmtDate } from '../../components/ui';
import { Pager, Table, useStaffGet, type R } from './common';

export default function Activity() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const { data, error, reload } = useStaffGet<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/staff/activity?page=${page}&entity=${entity}`);
  return (
    <>
      <PageHeader title="Activity log" lead="Every submission, access failure and staff action is recorded. PINs and personal details are never logged." actions={<Select aria-label="Entity" className="!w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All</option>{['Complaint', 'FoundItem', 'Claim', 'Handover', 'Staff', 'Settings'].map((x) => <option key={x}>{x}</option>)}</Select>} />
      <Card className="overflow-hidden">
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <>
            <Table head={['When', 'Actor', 'Action', 'Record', 'Details']} empty={!data.rows.length}>
              {data.rows.map((a) => (
                <tr key={a.log_id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">{fmtDate(a.created_at)}</td>
                  <td className="px-4 py-3 text-xs">{a.actor}</td>
                  <td className="px-4 py-3 font-medium">{a.action.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.entity} {a.entity_id}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-ink-500" title={a.details}>{a.details}</td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
