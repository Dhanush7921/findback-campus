import { ArrowRight, Bell, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { StatusStepper } from '../../components/status';
import { Card, fmtDate } from '../../components/ui';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { usePortal } from './context';

export default function Overview() {
  const { t } = useI18n();
  const { data } = usePortal();
  const c = data.complaint;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-5">
        <Card className="p-6 animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-500">{t('portal.currentStatus')}</p>
          <h2 className="mt-1 text-2xl font-extrabold">{t(`status.${c.status}` as I18nKey)}</h2>
          <p className="mt-1 text-sm text-ink-500">{t(`statusDesc.${c.status}` as I18nKey)}</p>
          <div className="mt-6"><StatusStepper status={c.status} /></div>
          <p className="mt-5 text-xs text-ink-400">{t('common.lastUpdated')}: {fmtDate(c.updatedAt)}</p>
        </Card>
        <Card className="grid gap-4 p-6 sm:grid-cols-2">
          {[[t('submit.category'), c.category], [t('submit.itemName'), c.itemName], [t('submit.location'), c.lastSeenLocation], [t('submit.date'), `${fmtDate(c.lostDate, false)}${c.lostTime ? ' · ' + c.lostTime : ''}`]].map(([k, v]) => (
            <div key={k}><p className="text-xs font-semibold text-ink-400">{k}</p><p className="mt-0.5 font-medium">{v}</p></div>
          ))}
        </Card>
      </div>
      <div className="space-y-5">
        <Link to="matches" className="card group block p-5 transition hover:shadow-[var(--shadow-lift)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-700"><Sparkles className="h-5 w-5" /></div>
            <div className="flex-1"><p className="font-bold">{t('portal.matches')}</p><p className="text-sm text-ink-500">{data.matches.length ? `${data.matches.length}` : t('portal.noMatches')}</p></div>
            <ArrowRight className="h-5 w-5 text-ink-400 transition group-hover:translate-x-0.5" />
          </div>
        </Link>
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-2 font-bold"><Bell className="h-4 w-4 text-teal-600" /> {t('portal.notifications')}</p>
          {data.notifications.length === 0 ? <p className="text-sm text-ink-500">{t('portal.noUpdates')}</p> : (
            <ul className="space-y-3">
              {data.notifications.slice(0, 4).map((n) => (
                <li key={n.id} className="border-l-2 border-teal-200 pl-3"><p className="text-sm">{n.message}</p><p className="text-xs text-ink-400">{fmtDate(n.at)}</p></li>
              ))}
            </ul>
          )}
          <Link to="updates" className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">{t('portal.notifications')} →</Link>
        </Card>
      </div>
    </div>
  );
}
