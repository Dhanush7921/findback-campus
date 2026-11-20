import { HttpError } from './http';

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string }
let jwksCache: { keys: Jwk[]; exp: number } | null = null;

async function getJwks(fetchImpl: typeof fetch): Promise<Jwk[]> {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  const res = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new HttpError(503, 'auth_unavailable', 'Google sign-in verification unavailable');
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, exp: Date.now() + Math.min(Number(maxAge ?? 3600), 86400) * 1000 };
  return body.keys;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface GoogleClaims { email: string; email_verified: boolean; hd?: string; name?: string }

/** Verifies a Google Identity Services ID token (RS256) fully server-side. */
export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'invalid_token', 'Malformed token');
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    throw new HttpError(401, 'invalid_token', 'Malformed token');
  }
  if (header.alg !== 'RS256') throw new HttpError(401, 'invalid_token', 'Unsupported algorithm');
  const jwk = (await getJwks(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'invalid_token', 'Unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new HttpError(401, 'invalid_token', 'Bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(String(payload.iss))) throw new HttpError(401, 'invalid_token', 'Bad issuer');
  if (payload.aud !== clientId) throw new HttpError(401, 'invalid_token', 'Wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) throw new HttpError(401, 'invalid_token', 'Token expired');
  if (!payload.email || payload.email_verified !== true) throw new HttpError(401, 'invalid_token', 'Email not verified');
  return { email: String(payload.email).toLowerCase(), email_verified: true, hd: payload.hd as string | undefined, name: payload.name as string | undefined };
}

export type StaffRole = 'admin' | 'staff' | 'management';

export function parseStaffList(raw: string | undefined): Map<string, StaffRole> {
  const m = new Map<string, StaffRole>();
  for (const part of (raw ?? '').split(',')) {
    const [email, role] = part.trim().toLowerCase().split(':');
    if (email && email.includes('@')) m.set(email, role === 'admin' ? 'admin' : role === 'management' ? 'management' : 'staff');
  }
  return m;
}
