import { AlertTriangle, Check, Copy, KeyRound, Printer, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { LogoMark } from '../../components/art';
import { Button, ButtonLink, Card, Notice, fmtDate } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

interface Creds { complaintId: string; pin?: string; createdAt: string; verifiedIdentity?: boolean }

export default function Success() {
  const { t } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const [creds] = useState<Creds | null>(() => (loc.state as Creds | null) ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Remove credentials from history state so Back/refresh cannot re-display them.
  useEffect(() => { if (loc.state) nav('.', { replace: true, state: null }); }, [loc.state, nav]);

  if (!creds) {
    return (
      <div className="safe-x mx-auto max-w-xl py-16">
        <Notice tone="info">{t('success.expired')}</Notice>
        <ButtonLink to="/track" className="mt-6">{t('nav.track')}</ButtonLink>
      </div>
    );
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard blocked: user can select manually */ }
  }

  const Row = ({ label, value, which, mono }: { label: string; value: string; which: string; mono?: boolean }) => (
    <div className="rounded-2xl border border-silver-200 bg-silver-50/60 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-500">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className={`select-all break-all text-2xl font-extrabold tracking-wider text-ink-900 sm:text-3xl ${mono ? 'font-mono' : 'font-display'}`} data-testid={`cred-${which}`}>{value}</p>
        <Button variant="secondary" size="sm" className="no-print" onClick={() => copy(value, which)} aria-label={`${t('success.copy')} ${label}`}>
          {copied === which ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied === which ? t('success.copied') : t('success.copy')}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="safe-x mx-auto max-w-2xl py-10 sm:py-14">
      <div className="mb-6 text-center animate-rise no-print">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700 ring-8 ring-emerald-50"><Check className="h-8 w-8" strokeWidth={3} /></div>
        <h1 className="text-3xl font-extrabold">{t('success.title')}</h1>
        <p className="mx-auto mt-2 max-w-md text-ink-500">{creds.pin ? t('success.lead') : 'Your complaint is now available in your private verified-phone dashboard.'}</p>
      </div>
      <Card className="print-card space-y-4 p-6 sm:p-8 animate-rise">
        <div className="print-only mb-4"><div className="flex items-center gap-2"><LogoMark /> <strong>FindBack — Campus Lost &amp; Found</strong></div></div>
        <Row label={t('success.id')} value={creds.complaintId} which="id" />
        {creds.pin ? <Row label={t('success.pin')} value={creds.pin} which="pin" mono /> : <Notice tone="success">This complaint is securely linked to your verified phone account. No separate PIN is required.</Notice>}
        <p className="text-xs text-ink-500">{fmtDate(creds.createdAt)}</p>
        <div className="flex flex-col gap-2 sm:flex-row no-print">
          <Button variant="secondary" className="flex-1" onClick={() => copy(creds.pin ? `FindBack\nComplaint ID: ${creds.complaintId}\nPIN: ${creds.pin}` : `FindBack\nComplaint ID: ${creds.complaintId}`, 'both')}>
            <KeyRound className="h-4 w-4" /> {copied === 'both' ? t('success.copied') : creds.pin ? t('success.copyBoth') : 'Copy complaint ID'}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => window.print()}><Printer className="h-4 w-4" /> {t('success.print')}</Button>
        </div>
        {creds.pin && <ul className="space-y-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t('success.warn1')}</li><li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {t('success.warn2')}</li></ul>}
      </Card>
      <div className="mt-6 space-y-4 no-print">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-ink-700">
          <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> {creds.pin ? t('success.confirm') : 'I have noted my Complaint ID'}
        </label>
        <ButtonLink to={creds.verifiedIdentity ? '/dashboard' : '/track'} className={`w-full ${saved ? '' : 'pointer-events-none opacity-50'}`} aria-disabled={!saved}>{creds.verifiedIdentity ? 'Open my private dashboard' : t('success.continue')}</ButtonLink>
      </div>
    </div>
  );
}
