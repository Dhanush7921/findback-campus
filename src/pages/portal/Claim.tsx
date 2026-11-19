import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Notice, Textarea } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Claim() {
  const { t } = useI18n();
  const { itemId } = useParams();
  const { data, reload } = usePortal();
  const nav = useNavigate();
  const toast = useToast();
  const [evidence, setEvidence] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const match = data.matches.find((m) => m.itemId === itemId);
  if (!match) return <Navigate to="../matches" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (evidence.trim().length < 10) { setErr('Please write at least 10 characters.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/api/portal/claim', { itemId, evidence }, { auth: 'student' });
      toast(t('portal.claimSent'));
      await reload();
      nav('/portal/timeline', { replace: true });
    } catch (e2) {
      setErr((e2 as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mx-auto max-w-2xl p-6 sm:p-8">
      <h2 className="text-xl font-bold">{t('portal.claimTitle')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('portal.claimLead')}</p>
      <div className="my-5 rounded-2xl bg-silver-50 p-4 text-sm"><strong>{match.item.itemName}</strong> — {match.item.description}</div>
      <form onSubmit={submit} className="space-y-5">
        <Field label={t('portal.claimEvidence')} required error={err ?? undefined}>
          {(id, d) => <Textarea id={id} aria-describedby={d} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} invalid={!!err} />}
        </Field>
        <Notice tone="info">{t('portal.bring')}</Notice>
        <Button type="submit" className="w-full" loading={busy}>{t('portal.claimSubmit')}</Button>
      </form>
    </Card>
  );
}
