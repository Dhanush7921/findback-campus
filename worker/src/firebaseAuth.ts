import { HttpError } from './http';

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string; use?: string }
let cache: { keys: Jwk[]; exp: number } | null = null;

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keys(fetchImpl: typeof fetch): Promise<Jwk[]> {
  if (cache && cache.exp > Date.now()) return cache.keys;
  const res = await fetchImpl('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new HttpError(503, 'auth_unavailable', 'Phone verification is temporarily unavailable.');
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new HttpError(503, 'auth_unavailable', 'Phone verification is temporarily unavailable.');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cache = { keys: body.keys, exp: Date.now() + Math.min(Math.max(maxAge, 60), 86400) * 1000 };
  return cache.keys;
}

export interface FirebasePhoneClaims {
  uid: string;
  phoneNumber: string;
  authTime: number;
}

/** Verifies a Firebase Authentication ID token and requires the phone provider. */
export async function verifyFirebasePhoneToken(
  token: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FirebasePhoneClaims> {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 8192) throw new HttpError(401, 'invalid_token', 'Invalid phone verification token.');
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch {
    throw new HttpError(401, 'invalid_token', 'Invalid phone verification token.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'invalid_token', 'Invalid phone verification token.');
  const jwk = (await keys(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'invalid_token', 'Phone verification signing key is not recognised.');
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
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new HttpError(401, 'invalid_token', 'Invalid phone verification token.');
  const now = Math.floor(Date.now() / 1000);
  const aud = String(payload.aud ?? '');
  const iss = String(payload.iss ?? '');
  const uid = String(payload.sub ?? '');
  const exp = Number(payload.exp ?? 0);
  const iat = Number(payload.iat ?? 0);
  const authTime = Number(payload.auth_time ?? 0);
  const phoneNumber = String(payload.phone_number ?? '');
  const firebase = (payload.firebase ?? {}) as Record<string, unknown>;
  if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) throw new HttpError(401, 'invalid_token', 'Phone verification token is for another project.');
  if (!uid || uid.length > 128 || exp < now - 30 || iat > now + 30 || authTime <= 0) throw new HttpError(401, 'invalid_token', 'Phone verification token has expired.');
  if (firebase.sign_in_provider !== 'phone' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    throw new HttpError(401, 'phone_required', 'A verified mobile phone number is required.');
  }
  return { uid, phoneNumber, authTime };
}
