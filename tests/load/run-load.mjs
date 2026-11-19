// Capacity benchmark for the Worker gateway + Apps Script data layer.
//
// Local mode (default): bundles the real Worker code for Node, points it at the Apps Script
// emulator running the real Code.gs with an injected per-call latency and Apps Script's
// 30-simultaneous-execution cap, and measures throughput/latency at several concurrencies.
// This MODELS Google-side behaviour; it is not a measurement of Google's servers.
//
// Live mode: node tests/load/run-load.mjs --target https://<worker>.workers.dev --complaint FB-… --pin …
// runs read-only portal load against a deployed API (use a test complaint; respect quotas).
import autocannon from 'autocannon';
import { build } from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGasServer } from '../gas/emulator.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('--target');
const duration = Number(arg('--duration', 15));
const latencyMs = Number(arg('--gas-latency', 900)); // typical observed Apps Script web-app round trip ~0.6–1.5 s
const results = [];

async function run(name, opts) {
  const r = await autocannon({ duration, ...opts });
  const row = {
    scenario: name,
    connections: opts.connections,
    rps: Math.round(r.requests.average * 10) / 10,
    p50_ms: r.latency.p50,
    p97_5_ms: r.latency.p97_5,
    p99_ms: r.latency.p99,
    ok_2xx: r['2xx'],
    non2xx: r.non2xx,
    errors: r.errors + r.timeouts,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  return row;
}

let base = target;
let stop = async () => {};
if (!target) {
  const out = path.resolve('node_modules/.tmp/worker-node.mjs');
  await build({ entryPoints: ['worker/src/app.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  const { createApp } = await import(pathToFileURL(out).href);
  const { AppsScriptStore } = await import(pathToFileURL(await (async () => {
    const o = path.resolve('node_modules/.tmp/gas-store.mjs');
    await build({ entryPoints: ['worker/src/store/appsScript.ts'], bundle: true, platform: 'node', format: 'esm', outfile: o, logLevel: 'error' });
    return o;
  })()).href);
  const gas = await startGasServer({ port: 0, latencyMs, maxConcurrent: 30 });
  const handle = createApp({
    env: { APP_ENV: 'production', PIN_PEPPER: 'load-test-pepper-xxxxxxxx', SESSION_KEY: 'load-test-session-key-xxxxxxxx', ALLOWED_ORIGINS: '' },
    store: new AppsScriptStore(gas.url, gas.runtime.secret, { retries: 3, timeoutMs: 30000 }),
  });
  const origLog = console.log;
  const server = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      headers.set('cf-connecting-ip', req.headers['x-load-ip'] ?? '10.9.9.9');
      console.log = () => {};
      const r = await handle(new Request(`http://local${req.url}`, { method: req.method, headers, body: body || undefined }));
      console.log = origLog;
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  stop = async () => { server.close(); gas.server.close(); };
  console.log(`Local model: Apps Script latency ≈${latencyMs} ms/call, 30 concurrent executions max, writes serialised by LockService.`);
}

const ip = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const complaint = (i) => ({
  name: 'Load Test', studentId: `LT${i}`, department: 'QA', phone: '+91 90000 00000', email: '', category: 'Keys',
  itemName: 'Bike keys', description: 'Two keys on a red ring with a small torch', colorFeatures: 'Red ring', lastSeenLocation: 'Parking lot',
  lostDate: new Date().toISOString().slice(0, 10), lostTime: '', ownershipEvidence: 'Torch has my initials scratched on it',
  idempotencyKey: crypto.randomUUID(), elapsedMs: 20000, website: '',
});

// Seed one complaint and a session for portal reads.
let token;
if (!target) {
  const r = await fetch(`${base}/api/complaints`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-load-ip': ip() }, body: JSON.stringify(complaint(0)) });
  const c = await r.json();
  const a = await (await fetch(`${base}/api/access`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-load-ip': ip() }, body: JSON.stringify({ complaintId: c.complaintId, pin: c.pin }) })).json();
  token = a.token;
} else {
  const a = await (await fetch(`${base}/api/access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ complaintId: arg('--complaint'), pin: arg('--pin') }) })).json();
  token = a.token;
}
if (!token) throw new Error('could not obtain a session token');

for (const c of target ? [5, 10] : [10, 30, 60]) {
  await run('portal_read (authenticated GET /api/portal)', {
    url: `${base}/api/portal`, connections: c,
    setupClient: (client) => client.setHeaders({ authorization: `Bearer ${token}`, 'x-load-ip': ip() }),
  });
}
await run('public_config (GET /api/public/config, cached 60 s in isolate)', { url: `${base}/api/public/config`, connections: 30, setupClient: (client) => client.setHeaders({ 'x-load-ip': ip() }) });
if (!target) {
  let i = 1;
  for (const c of [5, 20]) {
    await run('submit_complaint (POST /api/complaints, write)', {
      url: `${base}/api/complaints`, connections: c, method: 'POST',
      setupClient: (client) => client.setHeaders({ 'content-type': 'application/json', 'x-load-ip': ip() }),
      requests: [{ method: 'POST', setupRequest: (req) => ({ ...req, headers: { ...req.headers, 'x-load-ip': ip() }, body: JSON.stringify(complaint(i++)) }) }],
    });
  }
}
await stop();
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(target ? 'docs/load-results-live.json' : 'docs/load-results-local.json', JSON.stringify({ at: new Date().toISOString(), target: target ?? 'local-model', gasLatencyMs: target ? null : latencyMs, durationS: duration, results }, null, 2));
console.table(results);
