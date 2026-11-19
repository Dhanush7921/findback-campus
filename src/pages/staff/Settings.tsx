import { useEffect, useState } from 'react';
import { useToast } from '../../components/toast';
import { Button, Card, ErrorState, Field, Input, Notice, PageHeader, PageSkeleton, Select } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useStaffGet } from './common';

const LABELS: Record<string, [string, string?]> = {
  collection_office: ['Collection office location'],
  collection_hours: ['Collection hours'],
  contact_email: ['Public contact email'],
  contact_phone: ['Public contact phone'],
  unclaimed_days: ['Days before an item counts as unclaimed', 'number'],
  retention_days: ['Days to keep personal data after closure', 'number'],
  require_two_staff: ['Require a different staff member for handover', 'bool'],
  submissions_open: ['Accept new complaints', 'bool'],
};

export default function Settings() {
  const toast = useToast();
  const { data, error, reload } = useStaffGet<{ settings: Record<string, string>; editable: boolean; staffCount: number; staffDomain: string }>('/api/staff/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const save = async () => {
    setBusy('save');
    try { await apiPost('/api/staff/settings', { settings: form }, { auth: 'staff' }); toast('Settings saved'); await reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const backup = async () => {
    setBusy('backup');
    try { const r = await apiPost<{ name: string }>('/api/staff/backup', {}, { auth: 'staff', timeoutMs: 90000 }); toast(`Backup created: ${r.name}`); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="Management settings" lead={data.editable ? 'Changes apply within a minute.' : 'Read-only: administrator role required to change settings.'} />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="grid gap-5 p-6 sm:grid-cols-2">
          {Object.entries(LABELS).map(([k, [label, type]]) => (
            <Field key={k} label={label} className={type ? '' : 'sm:col-span-2'}>
              {(id) => type === 'bool' ? (
                <Select id={id} value={form[k] ?? ''} disabled={!data.editable} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))}><option value="true">Yes</option><option value="false">No</option></Select>
              ) : (
                <Input id={id} type={type === 'number' ? 'number' : 'text'} min={type === 'number' ? 1 : undefined} value={form[k] ?? ''} disabled={!data.editable} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))} />
              )}
            </Field>
          ))}
          {data.editable && <div className="sm:col-span-2"><Button loading={busy === 'save'} onClick={save}>Save settings</Button></div>}
        </Card>
        <div className="space-y-5">
          <Card className="space-y-3 p-6">
            <h2 className="font-bold">Staff access</h2>
            <p className="text-sm text-ink-500">{data.staffCount} authorised account(s){data.staffDomain ? `, restricted to @${data.staffDomain}` : ''}. The allowlist is managed in the API configuration (STAFF_EMAILS) so it cannot be changed from the browser.</p>
          </Card>
          <Card className="space-y-3 p-6">
            <h2 className="font-bold">Backup</h2>
            <p className="text-sm text-ink-500">A private copy of the spreadsheet is made daily at 02:00 (14 kept). Create one now before bulk changes.</p>
            {data.editable ? <Button variant="secondary" loading={busy === 'backup'} onClick={backup}>Create backup now</Button> : <Notice tone="info">Administrator only.</Notice>}
          </Card>
        </div>
      </div>
    </>
  );
}
