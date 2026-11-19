import { HelpCircle, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { accessInput } from '../../../shared/domain';
import { ShieldArt } from '../../components/art';
import { Button, Card, Field, Input, Notice } from '../../components/ui';
import { ApiError, apiConfigured, apiPost } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { useI18n } from '../../lib/i18n';
import { saveSession } from '../../lib/session';

function formatId(v: string) {
  const raw = v.toUpperCase().replace(/^\s*FB-?/, '').replace(/[^0-9A-Z]/g, '').slice(0, 8);
  if (!raw) return '';
  return 'FB-' + (raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
}

export default function Track() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { config } = useConfig();
  const [id, setId] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ complaintId?: string; pin?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const fmt = (v: string, groups: number[]) => {
    const raw = v.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const out: string[] = [];
    let i = 0;
    for (const g of groups) { if (i >= raw.length) break; out.push(raw.slice(i, i + g)); i += g; }
    return out.join('-');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const isDemo = config?.environment === 'development' && (id === 'FB-1223' || id === '1223');
    const parsed = accessInput.safeParse({ complaintId: id, pin });
    if (!parsed.success && !isDemo) {
      const errs: typeof errors = {};
      for (const i of parsed.error.issues) errs[i.path[0] as 'pin'] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const body = isDemo ? { complaintId: '1223', pin } : parsed.data;
      const r = await apiPost<{ token: string; expiresAt: number }>('/api/access', body);
      saveSession('student', r.token, r.expiresAt);
      setPin('');
      nav('/portal', { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="safe-x mx-auto grid max-w-5xl items-center gap-10 py-10 sm:py-16 md:grid-cols-[1fr_1.1fr]">
      <div className="hidden md:block">
        <div className="mx-auto w-64"><ShieldArt /></div>
        <p className="mx-auto mt-6 max-w-xs text-center text-sm text-ink-500">{t('access.secure')}</p>
      </div>
      <Card className="p-6 sm:p-9 animate-rise">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-white"><LockKeyhole className="h-6 w-6" /></div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{t('access.title')}</h1>
        <p className="mt-2 text-sm text-ink-500">{t('access.lead')}</p>
        {!apiConfigured() && <Notice tone="warn" className="mt-4">{t('common.notConnected')}</Notice>}
        <form onSubmit={submit} noValidate className="mt-6 space-y-5">
          <Field label={t('access.id')} required error={errors.complaintId}>
            {(fid, d) => <Input id={fid} aria-describedby={d} value={id} onChange={(e) => setId(formatId(e.target.value))} placeholder="FB-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono tracking-wider" invalid={!!errors.complaintId} />}
          </Field>
          <Field label={t('access.pin')} required error={errors.pin}>
            {(fid, d) => <Input id={fid} aria-describedby={d} type="password" value={pin} onChange={(e) => setPin(fmt(e.target.value, [4, 4, 2]))} placeholder="XXXX-XXXX-XX" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono tracking-wider" invalid={!!errors.pin} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!apiConfigured()}>{busy ? t('access.verifying') : t('access.submit')}</Button>
        </form>
        <button className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline" onClick={() => setShowForgot((v) => !v)} aria-expanded={showForgot}>
          <HelpCircle className="h-4 w-4" /> {t('access.forgot')}
        </button>
        {showForgot && <p className="mt-2 rounded-xl bg-silver-50 p-3 text-sm text-ink-600 animate-fade">{t('access.forgotText')}</p>}
      </Card>
    </div>
  );
}
