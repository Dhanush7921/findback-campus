import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { AppsScriptStore } from '../src/store/appsScript';
import { MemoryStore } from '../src/store/memory';
import type { Store } from '../src/store/types';
// @ts-expect-error — plain JS test harness
import { createGasRuntime } from '../../tests/gas/emulator.mjs';

export const ORIGIN = 'http://localhost:5173';
export const baseEnv: Env = {
  APP_ENV: 'production',
  PIN_PEPPER: 'test-pepper-0123456789abcdef',
  SESSION_KEY: 'test-session-key-0123456789abcd',
  ALLOWED_ORIGINS: ORIGIN,
};

/** AppsScriptStore wired to the real Code.gs running in the emulator (no network). */
export function gasStore(): { store: Store; runtime: ReturnType<typeof createGasRuntime> } {
  const runtime = createGasRuntime();
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const out = await runtime.doPost(String(init.body));
    return new Response(out, { status: 200 });
  }) as unknown as typeof fetch;
  return { store: new AppsScriptStore('https://script.google.com/macros/s/EMU/exec', runtime.secret, { fetchImpl, retries: 0 }), runtime };
}

export function makeClient(opts: { env?: Partial<Env>; store?: Store | null; ip?: string; now?: () => number } = {}) {
  const store = opts.store === undefined ? new MemoryStore() : opts.store;
  const handle = createApp({ env: { ...baseEnv, ...opts.env }, store, now: opts.now });
  let n = 0;
  async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': opts.ip ?? `10.0.0.${(n++ % 200) + 1}`, ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { /* binary */ }
    return { status: res.status, json, headers: res.headers };
  }
  return { call, store, handle };
}

export function complaintBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Asha Reddy',
    studentId: '22CSE104',
    department: 'CSE — II Year',
    phone: '+91 98765 43210',
    email: 'asha@example.edu',
    category: 'Bag / Backpack',
    itemName: 'Black backpack',
    description: 'Black backpack with a laptop sleeve and two front pockets',
    colorFeatures: 'Black with red zipper pulls',
    lastSeenLocation: 'Central library, second floor',
    lostDate: new Date().toISOString().slice(0, 10),
    lostTime: '13:15',
    ownershipEvidence: 'There is a green notebook inside with my roll number on the cover',
    idempotencyKey: crypto.randomUUID(),
    elapsedMs: 15000,
    website: '',
    ...over,
  };
}

export const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAP/2Q==';
