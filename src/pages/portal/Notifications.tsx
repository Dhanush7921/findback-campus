import { Bell } from 'lucide-react';
import { Card, EmptyState, fmtDate } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { usePortal } from './context';

export default function Notifications() {
  const { t } = useI18n();
  const { data } = usePortal();
  if (!data.notifications.length) return <Card><EmptyState title={t('portal.noUpdates')} /></Card>;
  return (
    <Card className="divide-y divide-silver-100">
      {data.notifications.map((n) => (
        <div key={n.id} className="flex gap-4 p-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Bell className="h-5 w-5" /></div>
          <div><p className="text-sm">{n.message}</p><p className="mt-1 text-xs text-ink-400">{fmtDate(n.at)}</p></div>
        </div>
      ))}
    </Card>
  );
}
