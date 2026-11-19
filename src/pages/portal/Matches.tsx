import { CalendarDays, MapPin, Palette } from 'lucide-react';
import { EmptyBoxArt } from '../../components/art';
import { StatusBadge } from '../../components/status';
import { ButtonLink, Card, EmptyState, fmtDate } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Matches() {
  const { t } = useI18n();
  const { data } = usePortal();
  if (!data.matches.length) return <Card><EmptyState art={<EmptyBoxArt />} title={t('portal.noMatches')} text={t('portal.noMatchesText')} /></Card>;
  const canClaim = data.complaint.status === 'Potential Match';
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.matches.map((m) => (
        <Card key={m.itemId} className="flex flex-col p-6 animate-rise">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-violet-700">{m.item.category}</p>
              <h3 className="mt-0.5 text-lg font-bold">{m.item.itemName}</h3>
            </div>
            {m.claimStatus && <StatusBadge status={m.claimStatus} />}
          </div>
          <p className="mt-2 text-sm text-ink-600">{m.item.description}</p>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-500">
            <li className="flex gap-2"><Palette className="h-4 w-4 shrink-0 text-teal-600" /> {m.item.colorFeatures}</li>
            <li className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-teal-600" /> {t('portal.foundAt')}: {m.item.foundLocation}</li>
            <li className="flex gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-teal-600" /> {t('portal.foundOn')}: {fmtDate(m.item.foundDate, false)}</li>
          </ul>
          {m.note && <p className="mt-4 rounded-xl bg-silver-50 p-3 text-sm text-ink-600">{m.note}</p>}
          <div className="mt-auto pt-5">
            {!m.claimStatus && canClaim && <ButtonLink to={`${m.itemId}/claim`} className="w-full">{t('portal.requestClaim')}</ButtonLink>}
            {m.claimStatus && <p className="text-sm text-ink-500">{t('portal.claimStatus')}: <strong>{m.claimStatus}</strong></p>}
          </div>
        </Card>
      ))}
    </div>
  );
}
