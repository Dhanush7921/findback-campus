import { Card, fmtDate } from '../../components/ui';
import { StatusBadge } from '../../components/status';
import { usePortal } from './context';

export default function Timeline() {
  const { data } = usePortal();
  return (
    <Card className="p-6 sm:p-8">
      <ol className="relative space-y-7 border-l-2 border-teal-100 pl-6">
        {data.timeline.map((e, i) => (
          <li key={i} className="relative animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
            <span className={`absolute -left-[33px] top-0.5 h-4 w-4 rounded-full ring-4 ring-white ${i === data.timeline.length - 1 ? 'brand-gradient' : 'bg-teal-300'}`} aria-hidden />
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.status} /><span className="text-xs text-ink-400">{fmtDate(e.at)}</span></div>
            <p className="mt-1.5 text-sm text-ink-700">{e.message}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
