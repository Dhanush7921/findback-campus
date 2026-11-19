# Security model

## Trust boundaries
- **Browser / app**: untrusted. Hiding a button is never a control; every rule is enforced in the Worker.
- **Worker**: holds `PIN_PEPPER`, `SESSION_KEY`, `GAS_SHARED_SECRET`. Stateless; enforces authentication, authorization, validation and workflow rules on every request.
- **Apps Script**: accepts only HMAC-SHA256-signed envelopes (timestamp ±5 min, single-use nonce cached 10 min). Executes as the sheet owner; never exposes Sheets/Drive publicly.

## Controls
| Threat | Control |
|---|---|
| Guessing complaint access | 40-bit random IDs + 50-bit random PINs (crypto RNG, unambiguous alphabet); 5 failures → lock 15 min, doubling up to 24 h (stored in `Access_Credentials`, so it survives Worker restarts); per-IP and per-ID rate limits; identical error for unknown ID and wrong PIN |
| PIN disclosure | Only `HMAC-SHA256(pepper, "pin:v1:" + id + ":" + pin)` is stored; pepper never in the sheet; PIN shown once, never in URLs, logs, storage or analytics; print/copy only on the success screen, which wipes router state |
| Session theft / replay | HMAC-signed tokens, 15-min student / 2-h staff expiry, `sessionStorage` only, bound to credential version (staff PIN reset revokes sessions), native app clears sessions after 5 min in background |
| Cross-complaint access | Student endpoints take no complaint ID — the ID comes only from the verified token. Tests assert isolation |
| Staff impersonation | Google ID token verified server-side (RS256 via Google JWKS, `aud`, `iss`, `exp`, `email_verified`, optional `hd`), then allowlist + role checked on **every** request (removing an email revokes immediately). Admin-only: settings, backups |
| Unprotected admin | Staff API returns `503 staff_disabled` until OAuth + allowlist are configured; dev login exists only when `APP_ENV=development` and the store is local |
| False claims | Students never see found-item photos or private details; approval requires three explicit staff checks; handover requires an approved claim, an in-person ID check and (optionally) a second staff member; everything is logged |
| Spam / bots | Honeypot, minimum fill time, idempotency keys, rate limits, optional Turnstile, office "pause submissions" switch |
| Injection | zod validation on both sides, control-char stripping, React output escaping, spreadsheet formula-injection escaping (`'` prefix), strict CSP meta, JSON-only API |
| Malicious uploads | JPEG/PNG/WebP only, magic-byte check, 3 MB cap, client re-encode strips EXIF/GPS, files stored in a private folder and served only through authorised endpoints with `no-store` |
| Data leakage via caches | API responses `Cache-Control: no-store`; service worker precaches static assets only and never caches `/api/*`; complaint data held in memory only |
| Transport | HTTPS everywhere (Pages, workers.dev, Apps Script); HSTS, nosniff, frame-deny, referrer `no-referrer`; CORS allow-list and requests from other origins refused with 403 |
| Logs | Structured access logs contain method, redacted path, status and timing only — tests assert PINs, IDs and names never appear |

## Known limitations / residual risk
- Per-IP limits must stay generous because campus NAT puts many students behind one IP; enable Turnstile if abuse appears.
- The Rate Limiting binding is per-location and eventually consistent; durable brute-force protection is the per-complaint lockout.
- `sessionStorage` tokens are readable by injected script; the strict CSP and absence of third-party scripts (except Google sign-in / Turnstile when enabled) mitigate this.
- The Apps Script web app must be "Anyone" to be callable from Cloudflare; protection relies on the shared secret — rotate it if it may have leaked.
- Sheet owners and editors can read all data in the sheet. Limit editors to the lost & found administrators.
