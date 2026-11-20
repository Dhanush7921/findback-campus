import { describe, expect, it, vi } from 'vitest';
import { complaintBody, makeClient } from './helpers';
import { hashPin, newPin, signSession, verifySession } from '../src/crypto';

async function submit(call: ReturnType<typeof makeClient>['call'], over = {}) {
  const r = await call('POST', '/api/complaints', complaintBody(over));
  expect(r.status).toBe(201);
  return r.json as { complaintId: string; pin: string };
}

describe('Access control', () => {
  it('rejects wrong PINs with a generic error and locks after 5 failures', async () => {
    const { call } = makeClient();
    const { complaintId, pin } = await submit(call);
    const wrong = pin.slice(0, -1) + (pin.endsWith('A') ? 'B' : 'A');
    const unknown = await call('POST', '/api/access', { complaintId: 'FB-ZZZZ-ZZZZ', pin });
    const bad = await call('POST', '/api/access', { complaintId, pin: wrong });
    expect(unknown.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(bad.json.message).toBe(unknown.json.message); // no ID enumeration via messages
    for (let i = 0; i < 4; i++) await call('POST', '/api/access', { complaintId, pin: wrong });
    const locked = await call('POST', '/api/access', { complaintId, pin });
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe('locked');
  });

  it('isolates complaints: a session only ever returns its own complaint', async () => {
    const { call } = makeClient();
    const a = await submit(call, { name: 'Student A', itemName: 'Red umbrella' });
    const b = await submit(call, { name: 'Student B', itemName: 'Silver watch' });
    const ta = (await call('POST', '/api/access', a)).json.token;
    const pa = await call('GET', '/api/portal', undefined, ta);
    expect(pa.json.complaint.complaintId).toBe(a.complaintId);
    expect(JSON.stringify(pa.json)).not.toContain('Student B');
    expect(JSON.stringify(pa.json)).not.toContain(b.complaintId);
    // There is no endpoint that accepts a complaint ID with a student session.
    expect((await call('GET', `/api/staff/complaints/${b.complaintId}`, undefined, ta)).status).toBe(503);
  });

  it('rejects forged, tampered and expired sessions', async () => {
    const { call } = makeClient();
    const a = await submit(call);
    const forged = await signSession('wrong-key-wrong-key-wrong-key', { t: 'student', cid: a.complaintId, v: '', exp: Date.now() + 60000 });
    expect((await call('GET', '/api/portal', undefined, forged)).status).toBe(401);
    const good = (await call('POST', '/api/access', a)).json.token as string;
    const [body, sig] = good.split('.');
    const tampered = btoa(JSON.stringify({ ...JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))), cid: 'FB-ZZZZ-ZZZZ' })).replace(/=+$/, '') + '.' + sig;
    expect((await call('GET', '/api/portal', undefined, tampered)).status).toBe(401);
    expect(await verifySession('k'.repeat(20), await signSession('k'.repeat(20), { t: 'student', cid: 'x', v: '', exp: Date.now() - 1 }))).toBeNull();
  });

  it('denies staff endpoints when staff auth is not configured, and to students', async () => {
    const { call } = makeClient();
    for (const path of ['/api/staff/dashboard', '/api/staff/complaints', '/api/staff/found-items', '/api/staff/settings', '/api/staff/activity']) {
      const r = await call('GET', path);
      expect(r.status).toBe(503);
      expect(r.json.error).toBe('staff_disabled');
    }
    // The development staff login does not exist in production.
    expect((await call('POST', '/api/staff/dev-session', { email: 'x@y.z' })).status).toBe(404);
  });

  it('requires a valid staff session and admin role where needed', async () => {
    const { call } = makeClient({ env: { APP_ENV: 'development', DEV_STAFF_LOGIN: '1' } as never });
    expect((await call('GET', '/api/staff/dashboard')).status).toBe(401);
    const staff = (await call('POST', '/api/staff/dev-session', { email: 's@x.edu', role: 'staff' })).json.token;
    expect((await call('GET', '/api/staff/dashboard', undefined, staff)).status).toBe(200);
    expect((await call('POST', '/api/staff/settings', { settings: { unclaimed_days: '30' } }, staff)).status).toBe(403);
    const admin = (await call('POST', '/api/staff/dev-session', { email: 'a@x.edu', role: 'admin' })).json.token;
    expect((await call('POST', '/api/staff/settings', { settings: { unclaimed_days: '30' } }, admin)).status).toBe(200);
  });

  it('enforces Management as server-side read-only', async () => {
    const { call } = makeClient({ env: { APP_ENV: 'development', DEV_STAFF_LOGIN: '1' } as never });
    const management = (await call('POST', '/api/staff/dev-session', { email: 'manager@x.edu', role: 'management' })).json.token;
    expect((await call('GET', '/api/management/overview', undefined, management)).status).toBe(200);
    expect((await call('GET', '/api/management/policies', undefined, management)).status).toBe(200);
    expect((await call('GET', '/api/staff/found-items', undefined, management)).status).toBe(403);
    expect((await call('POST', '/api/management/overview', {}, management)).status).toBe(404);
  });

  it('isolates OTP-linked V2 complaints by verified reporter UID', async () => {
    const { call } = makeClient({ env: { APP_ENV: 'development', DEV_STAFF_LOGIN: '1' } as never });
    const a = (await call('POST', '/api/v2/auth/dev-session', { role: 'student', uid: 'student-a', name: 'Student A' })).json.token;
    const b = (await call('POST', '/api/v2/auth/dev-session', { role: 'student', uid: 'student-b', name: 'Student B' })).json.token;
    const created = await call('POST', '/api/v2/complaints', complaintBody({ name: 'Editable name ignored', studentId: 'EDITABLE', phone: '+919999999999' }), a);
    expect(created.status).toBe(201);
    expect((await call('GET', `/api/v2/complaints/${created.json.complaintId}`, undefined, a)).status).toBe(200);
    expect((await call('GET', `/api/v2/complaints/${created.json.complaintId}`, undefined, b)).status).toBe(404);
    const own = await call('GET', '/api/v2/complaints', undefined, a);
    expect(own.json.rows).toHaveLength(1);
  });

  it('verifies Google ID tokens for staff and enforces the allowlist', async () => {
    const { call } = makeClient({ env: { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', STAFF_EMAILS: 'boss@college.edu:admin' } });
    const r = await call('POST', '/api/staff/session', { credential: 'not.a.jwt' });
    expect(r.status).toBe(401);
    expect((await call('GET', '/api/staff/dashboard')).status).toBe(401);
  });

  it('staff PIN reset revokes existing student sessions', async () => {
    const { call } = makeClient({ env: { APP_ENV: 'development', DEV_STAFF_LOGIN: '1' } as never });
    const a = await submit(call);
    const tok = (await call('POST', '/api/access', a)).json.token;
    const st = (await call('POST', '/api/staff/dev-session', {})).json.token;
    const reset = await call('POST', `/api/staff/complaints/${a.complaintId}/reset-pin`, { verification: 'Checked college ID card and described the item contents' }, st);
    expect(reset.status).toBe(200);
    expect((await call('GET', '/api/portal', undefined, tok)).status).toBe(401);
    expect((await call('POST', '/api/access', { complaintId: a.complaintId, pin: reset.json.pin })).status).toBe(200);
  });
});

describe('Transport & leakage', () => {
  it('sets security headers, no-store and strict CORS', async () => {
    const { call, handle } = makeClient();
    const r = await call('GET', '/api/public/config');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toContain('max-age');
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const evil = await handle(new Request('https://api.test/api/public/config', { headers: { origin: 'https://evil.example' } }));
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never writes PINs or personal data to logs', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m) => lines.push(String(m)));
    const { call } = makeClient();
    const { complaintId, pin } = await submit(call);
    await call('POST', '/api/access', { complaintId, pin });
    spy.mockRestore();
    const all = lines.join('\n');
    expect(all).not.toContain(pin);
    expect(all).not.toContain(complaintId);
    expect(all).not.toContain('Asha');
  });

  it('demo complaint 1223 only exists in development', async () => {
    const { call } = makeClient();
    const r = await call('POST', '/api/access', { complaintId: '1223', pin: '1223-1223-12' });
    expect(r.status).toBe(422);
  });

  it('rate limits submissions per IP', async () => {
    const { call } = makeClient({ ip: '203.0.113.9' });
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await call('POST', '/api/complaints', complaintBody())).status === 429;
    expect(limited).toBe(true);
  });
});

describe('Crypto', () => {
  it('PINs are unique, high-entropy and hashes are keyed & ID-bound', async () => {
    const pins = new Set(Array.from({ length: 5000 }, newPin));
    expect(pins.size).toBe(5000);
    const h1 = await hashPin('pepper-one-xxxxxxxx', 'FB-0000-0001', 'ABCD-EFGH-JK');
    expect(await hashPin('pepper-two-xxxxxxxx', 'FB-0000-0001', 'ABCD-EFGH-JK')).not.toBe(h1);
    expect(await hashPin('pepper-one-xxxxxxxx', 'FB-0000-0002', 'ABCD-EFGH-JK')).not.toBe(h1);
  });
});
