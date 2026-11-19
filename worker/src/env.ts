export interface Env {
  /** Apps Script web app /exec URL. */
  GAS_URL?: string;
  /** Shared HMAC secret also stored in Apps Script property FB_SHARED_SECRET. */
  GAS_SHARED_SECRET?: string;
  /** Secret pepper for keyed PIN hashes. Never stored in the spreadsheet. */
  PIN_PEPPER?: string;
  /** Secret for signing short-lived session tokens. */
  SESSION_KEY?: string;
  /** Comma-separated allowed browser origins. */
  ALLOWED_ORIGINS?: string;
  /** Google OAuth Web client ID for staff sign-in. Staff access is disabled if unset. */
  GOOGLE_CLIENT_ID?: string;
  /** "email:role,email:role" — roles: admin | staff. */
  STAFF_EMAILS?: string;
  /** Optional Google Workspace domain restriction (hd claim). */
  STAFF_DOMAIN?: string;
  /** Optional Cloudflare Turnstile secret; enables bot checks on submission. */
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  /** "development" enables the in-memory store and demo complaint 1223. Never in production. */
  APP_ENV?: string;
  /** Workers Rate Limiting bindings (optional; falls back to per-isolate limiter). */
  RL_SUBMIT?: RateLimit;
  RL_ACCESS?: RateLimit;
  RL_API?: RateLimit;
}

export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
