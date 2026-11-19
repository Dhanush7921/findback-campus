import { Clock, IdCard, MapPin } from 'lucide-react';
import { Card, Notice } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Collection() {
  const { t } = useI18n();
  const { data } = usePortal();
  const c = data.complaint;
  const ready = c.status === 'Ready for Collection';
  return (
    <Card className="mx-auto max-w-2xl p-6 sm:p-8">
      <h2 className="text-xl font-bold">{t('portal.collectTitle')}</h2>
      {c.status === 'Returned' ? <Notice tone="success" className="mt-4">{t('statusDesc.Returned')}</Notice> : !ready ? <Notice tone="info" className="mt-4">{t('portal.collectNotReady')}</Notice> : (
        <>
          <p className="mt-3 whitespace-pre-line rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">{data.collection.instructions || c.collectionInstructions}</p>
          <ul className="mt-5 space-y-3 text-sm">
            <li className="flex gap-3"><MapPin className="h-5 w-5 text-teal-600" /><span><strong>{t('portal.office')}:</strong> {data.collection.office}</span></li>
            <li className="flex gap-3"><Clock className="h-5 w-5 text-teal-600" /><span><strong>{t('portal.hours')}:</strong> {data.collection.hours}</span></li>
            <li className="flex gap-3"><IdCard className="h-5 w-5 text-teal-600" /><span>{t('portal.bring')}</span></li>
          </ul>
        </>
      )}
    </Card>
  );
}
