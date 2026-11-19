import { useState, type FormEvent } from 'react';
import { portalUpdateInput } from '../../../shared/domain';
import { useToast } from '../../components/toast';
import { Button, Card, Field, Input, Modal, Notice, Textarea } from '../../components/ui';
import { ApiError, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Update() {
  const { t } = useI18n();
  const { data, reload } = usePortal();
  const toast = useToast();
  const c = data.complaint;
  const [phone, setPhone] = useState(c.phone);
  const [email, setEmail] = useState(c.email);
  const [extra, setExtra] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [reason, setReason] = useState('');
  const locked = c.status === 'Closed' || c.status === 'Returned';

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = portalUpdateInput.safeParse({ phone, email, extraInfo: extra });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await apiPost('/api/portal/update', parsed.data, { auth: 'student' });
      setExtra('');
      toast(t('portal.updateSaved'));
      await reload();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.details) setErrors(ae.details);
      toast(ae.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    try {
      await apiPost('/api/portal/close', { reason }, { auth: 'student' });
      setConfirmClose(false);
      toast(t('portal.closed'));
      await reload();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  if (locked) return <Notice tone="info">{t(`statusDesc.${c.status}` as 'statusDesc.Closed')}</Notice>;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-bold">{t('portal.updateTitle')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('portal.updateLead')}</p>
        <form onSubmit={save} className="mt-6 space-y-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('submit.phone')} error={errors.phone}>{(id, d) => <Input id={id} aria-describedby={d} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!errors.phone} />}</Field>
            <Field label={t('submit.email')} error={errors.email}>{(id, d) => <Input id={id} aria-describedby={d} type="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} />}</Field>
          </div>
          <Field label={t('portal.extraInfo')} optionalLabel={t('common.optional')} error={errors.extraInfo}>{(id, d) => <Textarea id={id} aria-describedby={d} value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={1000} />}</Field>
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </form>
      </Card>
      <Card className="h-fit p-6">
        <h3 className="font-bold">{t('portal.closeTitle')}</h3>
        <p className="mt-1 text-sm text-ink-500">{t('portal.closeText')}</p>
        <Button variant="secondary" className="mt-4" onClick={() => setConfirmClose(true)}>{t('portal.closeBtn')}</Button>
      </Card>
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title={t('portal.closeBtn')}>
        <Field label="Reason" optionalLabel={t('common.optional')}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} onClick={close}>{t('portal.closeConfirm')}</Button>
        </div>
      </Modal>
    </div>
  );
}
