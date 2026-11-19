import { useState } from 'react';
import { Card, ErrorState, PageHeader, PageSkeleton } from '../../components/ui';
import { useStaffGet } from './common';

interface A { totals: { complaints: number; foundItems: number; handovers: number; returned: number }; recoveryRate: number; avgDaysToReturn: number | null; byCategory: Record<string, { lost: number; found: number }>; weeks: { week: string; complaints: number; found: number; returned: number }[] }

/** Single-series weekly bars (small multiples: one measure per chart, one hue). */
function WeeklyBars({ title, data, k }: { title: string; data: A['weeks']; k: 'complaints' | 'found' | 'returned' }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d[k]));
  const W = 360, H = 140, gap = 2, bw = W / data.length - gap;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between"><h3 className="text-sm font-bold">{title}</h3><span className="text-xs text-ink-500">{hover != null ? `Week of ${data[hover].week}: ${data[hover][k]}` : `Last 12 weeks · max ${max}`}</span></div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`${title} per week`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="#d7e0e0" />
        {data.map((d, i) => {
          const h = (d[k] / max) * (H - 8);
          const x = i * (bw + gap);
          return (
            <g key={d.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              <path d={h > 0 ? `M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z` : ''} fill={hover === i ? '#0f766e' : '#14b8a6'} />
              <title>{`Week of ${d.week}: ${d[k]}`}</title>
              {i % 3 === 0 && <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="#6c8381">{d.week.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

export default function Analytics() {
  const { data, error, reload } = useStaffGet<A>('/api/staff/analytics');
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const cats = Object.entries(data.byCategory).sort((a, b) => b[1].lost - a[1].lost);
  const maxLost = Math.max(1, ...cats.map(([, v]) => v.lost));
  const tiles = [['Complaints', data.totals.complaints], ['Found items', data.totals.foundItems], ['Handovers', data.totals.handovers], ['Recovery rate', `${data.recoveryRate}%`], ['Avg. days to return', data.avgDaysToReturn ?? '—']];
  return (
    <>
      <PageHeader title="Analytics & reports" lead="Operational trends from the records in Google Sheets." />
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([l, v]) => <Card key={l} className="p-5"><p className="font-display text-3xl font-extrabold">{v}</p><p className="text-sm text-ink-500">{l}</p></Card>)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <WeeklyBars title="Complaints submitted" data={data.weeks} k="complaints" />
        <WeeklyBars title="Items found" data={data.weeks} k="found" />
        <WeeklyBars title="Items returned" data={data.weeks} k="returned" />
      </div>
      <Card className="mt-6 p-6">
        <h2 className="mb-4 font-bold">Lost items by category</h2>
        <table className="w-full text-sm">
          <thead className="sr-only"><tr><th>Category</th><th>Lost</th><th>Found</th></tr></thead>
          <tbody>
            {cats.map(([c, v]) => (
              <tr key={c}>
                <td className="w-48 py-1.5 pr-3 text-ink-700">{c}</td>
                <td className="py-1.5"><div className="h-3 rounded-r-full bg-teal-500" style={{ width: `${(v.lost / maxLost) * 100}%`, minWidth: v.lost ? 4 : 0 }} title={`${v.lost} lost`} /></td>
                <td className="w-28 py-1.5 pl-3 text-right tabular-nums text-ink-700">{v.lost} lost · {v.found} found</td>
              </tr>
            ))}
            {!cats.length && <tr><td className="py-4 text-ink-500">No data yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
