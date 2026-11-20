// Cloud Run entry point: serves the same API (worker/src/app.ts) from Node.js, backed by Google Sheets + Cloud Storage.
import { createServer, type IncomingMessage } from 'node:http';
import { createApp } from '../worker/src/app';
import type { Env } from '../worker/src/env';
import { SheetsStore, type TokenSource } from '../worker/src/store/sheets';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/devstorage.read_write'];
const MAX_BODY = 8 * 1024 * 1024;

/** Service-identity token from the Cloud Run metadata server (no key files). GCP_ACCESS_TOKEN is for local testing only. */
function tokenSource(): TokenSource {
  let cached = { token: '', exp: 0 };
  return async () => {
    if (process.env.GCP_ACCESS_TOKEN) return process.env.GCP_ACCESS_TOKEN;
    if (cached.token && Date.now() < cached.exp) return cached.token;
    const res = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${SCOPES.join(',')}`,
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (!res.ok) throw new Error(`metadata token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
    return cached.token;
  };
}

const env: Env = {
  PIN_PEPPER: process.env.PIN_PEPPER,
  SESSION_KEY: process.env.SESSION_KEY,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
  STAFF_EMAILS: process.env.STAFF_EMAILS || undefined,
  STAFF_DOMAIN: process.env.STAFF_DOMAIN || undefined,
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || undefined,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || undefined,
  APP_ENV: 'production', // demo data and dev staff login can never be enabled on Cloud Run
};
const { SHEET_ID, BUCKET } = process.env;
const store = SHEET_ID && BUCKET ? new SheetsStore(SHEET_ID, BUCKET, tokenSource()) : null;
const handle = createApp({ env, store });

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : await readBody(req);
    if (body === null) { res.writeHead(413, { 'content-type': 'application/json' }).end('{"error":"too_large"}'); return; }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (k === 'cf-connecting-ip') continue; // client-spoofable off Cloudflare
    else if (typeof v === 'string') headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(', '));
    const request = new Request(`https://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body: body ? new Uint8Array(body) : undefined });
    const response = await handle(request);
    const out = Buffer.from(await response.arrayBuffer());
    const h: Record<string, string> = {};
    response.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(response.status, h).end(out);
  } catch (e) {
    console.error('request_failed', e instanceof Error ? e.message : 'unknown'); // never logs bodies (may contain PINs)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"internal"}');
  }
}).listen(Number(process.env.PORT ?? 8080), () => console.log(`findback-api listening (store: ${store ? 'sheets' : 'none'})`));

// Daily retention sweep while the service is running (date-based, so a missed day is caught up next time).
if (store) {
  const sweep = () => store.retentionSweep().then((n) => n && console.log(`retention: redacted ${n}`)).catch(() => undefined);
  setTimeout(sweep, 60_000);
  setInterval(sweep, 24 * 60 * 60 * 1000).unref();
}
