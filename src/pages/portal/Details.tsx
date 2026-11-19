import { useEffect, useState } from 'react';
import { Card, fmtDate } from '../../components/ui';
import { apiBlobUrl } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Details() {
  const { t } = useI18n();
  const { data } = usePortal();
  const c = data.complaint;
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!c.hasPhoto) return;
    let url: string | null = null;
    apiBlobUrl('/api/portal/photo', 'student').then((u) => { url = u; setPhoto(u); }).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [c.hasPhoto]);
  const rows: [string, string][] = [
    [t('submit.name'), c.name], [t('submit.studentId'), c.studentId], [t('submit.department'), c.department],
    [t('submit.phone'), c.phone || '—'], [t('submit.email'), c.email || '—'], [t('submit.category'), c.category],
    [t('submit.itemName'), c.itemName], [t('submit.description'), c.description], [t('submit.color'), c.colorFeatures],
    [t('submit.location'), c.lastSeenLocation], [t('submit.date'), `${fmtDate(c.lostDate, false)} ${c.lostTime}`],
    [t('submit.evidence'), c.ownershipEvidence], [t('portal.extraInfo'), c.extraInfo || '—'],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <Card className="divide-y divide-silver-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 p-4 sm:grid-cols-[200px_1fr]">
            <dt className="text-sm font-semibold text-ink-500">{k}</dt>
            <dd className="whitespace-pre-line break-words text-sm">{v}</dd>
          </div>
        ))}
      </Card>
      {c.hasPhoto && (
        <Card className="h-fit p-4">
          <p className="mb-3 text-sm font-semibold">{t('portal.yourPhoto')}</p>
          {photo ? <img src={photo} alt={c.itemName} className="w-full rounded-xl object-cover" /> : <div className="skeleton aspect-square" />}
        </Card>
      )}
    </div>
  );
}
