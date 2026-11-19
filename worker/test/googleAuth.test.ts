import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store/memory';
import { baseEnv, ORIGIN } from './helpers';

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  return { kp, jwk: { ...jwk, kid: 'k1' } };
}
const b64u = (s: string | Uint8Array) => Buffer.from(s).toString('base64url');
async function sign(kp: CryptoKeyPair, payload: object, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(sig)}`;
}

describe('Staff Google sign-in', () => {
  it('accepts a valid allowlisted token and rejects wrong audience, expired, or unlisted users', async () => {
    const { kp, jwk } = await keypair();
    const fetchImpl = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=60' } })) as unknown as typeof fetch;
    const env = { ...baseEnv, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', STAFF_EMAILS: 'boss@college.edu:admin,clerk@college.edu:staff', STAFF_DOMAIN: 'college.edu' };
    const handle = createApp({ env, store: new MemoryStore(), fetchImpl });
    const post = (credential: string) => handle(new Request('https://api.test/api/staff/session', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }));
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: now + 600, email_verified: true, hd: 'college.edu' };

    const ok = await post(await sign(kp, { ...base, email: 'Boss@College.edu' }));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { token: string; role: string };
    expect(body.role).toBe('admin');
    const dash = await handle(new Request('https://api.test/api/staff/dashboard', { headers: { origin: ORIGIN, authorization: `Bearer ${body.token}` } }));
    expect(dash.status).toBe(200);

    expect((await post(await sign(kp, { ...base, email: 'boss@college.edu', aud: 'other' }))).status).toBe(401);
    expect((await post(await sign(kp, { ...base, email: 'boss@college.edu', exp: now - 600 }))).status).toBe(401);
    expect((await post(await sign(kp, { ...base, email: 'boss@college.edu', email_verified: false }))).status).toBe(401);
    expect((await post(await sign(kp, { ...base, email: 'random@college.edu' }))).status).toBe(403);
    expect((await post(await sign(kp, { ...base, email: 'boss@college.edu', hd: 'gmail.com' }))).status).toBe(403);
    expect((await post(await sign(kp, { ...base, email: 'boss@college.edu' }, 'unknown-kid'))).status).toBe(401);
    const { kp: other } = await keypair();
    expect((await post(await sign(other, { ...base, email: 'boss@college.edu' }))).status).toBe(401);
    expect((await post('garbage')).status).toBe(401);
  });
});
