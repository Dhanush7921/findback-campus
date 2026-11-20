// In-process capacity estimate for the Cloud Run design: real API code + SheetsStore against a fake Google API
// with modelled latency (Sheets write ≈ 500 ms, read ≈ 300 ms). Run: npm run bench:sheets
import { createApp } from '../../worker/src/app';
import { SheetsStore } from '../../worker/src/store/sheets';
import { createFakeGoogle } from '../gcp/fake-google';

const g = createFakeGoogle();
const slow: typeof fetch = async (u, i) => { await new Promise((r) => setTimeout(r, i?.method === 'POST' ? 500 : 300)); return g.fetchImpl(u, i); };
const store = new SheetsStore('s', 'b', async () => 't', { fetchImpl: slow });
const env = { PIN_PEPPER: 'p'.repeat(32), SESSION_KEY: 'k'.repeat(32), ALLOWED_ORIGINS: 'https://x.test' };
const app = createApp({ env, store });
console.log = ((orig) => (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('{"reqId')) return; orig(...a); })(console.log);
let ipn = 0;
const call = (path: string, body?: unknown) => app(new Request(`https://api${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { origin: 'https://x.test', 'content-type': 'application/json', 'x-forwarded-for': `10.${(ipn >> 8) & 255}.${ipn++ & 255}.1` },
  body: body ? JSON.stringify(body) : undefined,
}));
const complaint = (i: number) => ({ name: 'Load Test', studentId: `22LT${i}`, department: 'CSE', phone: '+91 98765 43210', email: `lt${i}@example.edu`,
  category: 'Bag / Backpack', itemName: 'Black backpack', description: 'Black backpack with a laptop sleeve and two front pockets',
  colorFeatures: 'Black', lastSeenLocation: 'Central library', lostDate: new Date().toISOString().slice(0, 10), lostTime: '13:15',
  ownershipEvidence: 'Green notebook inside with my roll number', idempotencyKey: crypto.randomUUID(), elapsedMs: 15000 });

async function run(label: string, n: number, conc: number, fn: (i: number) => Promise<Response>) {
  const lat: number[] = []; let ok = 0, i = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; const s = Date.now(); const r = await fn(k); lat.push(Date.now() - s); if (r.status < 400) ok++; } }));
  const secs = (Date.now() - t0) / 1000; lat.sort((a, b) => a - b);
  console.log(`${label}: ${n} req, conc ${conc}: ${(n / secs).toFixed(1)} req/s, ok ${ok}, p50 ${lat[Math.floor(n / 2)]} ms, p95 ${lat[Math.floor(n * 0.95)]} ms`);
}
await call('/api/health');
await run('submit complaint (write)', 60, 20, (k) => call('/api/complaints', complaint(k)));
const sub = await (await call('/api/complaints', complaint(999))).json() as { complaintId: string; pin: string };
await run('PIN verify (read+hash)', 400, 50, () => call('/api/access', { complaintId: sub.complaintId, pin: sub.pin }));
await run('public config (read)', 2000, 100, () => call('/api/public/config'));
