# FindBack — Campus Lost & Found

A production web app, installable PWA and Android/iOS app for reporting lost items on campus, tracking them privately with a Complaint ID + secret PIN, and releasing them only after staff verification.

- **No student accounts.** A complaint is opened with its Complaint ID (`FB-XXXX-XXXX`) and a one-time-shown PIN (`XXXX-XXXX-XX`, ~50 bits). PINs are stored only as keyed HMAC-SHA256 hashes.
- **Staff console** (dashboard, found-item register with photos, inventory, complaints, matching, claim verification, handover, unclaimed items, activity log, analytics, settings) protected by Google Workspace sign-in + a server-side allowlist. It stays **disabled** until that is configured.
- **Google Sheets is the only record store**; photos go to a private Google Drive folder.

## Architecture

```
React + Vite + TS PWA  (GitHub Pages / Capacitor app)
        │ HTTPS, bearer session tokens (15 min student / 2 h staff)
        ▼
Cloudflare Worker  — validation, PIN hashing, sessions, authorization on every request,
                     rate limits, lockouts, CORS, security headers, matching, workflow rules
        │ HMAC-signed, timestamped, nonce-protected envelopes
        ▼
Google Apps Script web app — thin table service (get/query/append/update under LockService),
                             Drive uploads, daily backups, retention redaction
        ▼
Private Google Sheet (8 tabs) + private Drive folders
```

The `Store` interface (`worker/src/store/types.ts`) isolates persistence, so capacity work never touches the frontend or API contract.

| Path | What |
|---|---|
| `src/` | Frontend (public pages, student portal, staff console), i18n (English/Telugu) |
| `shared/domain.ts` | Statuses, transitions, sheet schemas, validation used by frontend **and** backend |
| `worker/` | Cloudflare Worker gateway + tests |
| `apps-script/` | `Code.gs` + `appsscript.json` for the spreadsheet |
| `tests/gas/emulator.mjs` | Runs the real `Code.gs` in Node with Sheets/Drive/Lock mocks (contract + E2E tests) |
| `tests/e2e/` | Playwright: UI → Worker (workerd) → emulated Apps Script |
| `tests/load/` | Capacity benchmark (local model or live target) |
| `android/`, `ios/` | Capacitor native projects |
| `docs/` | Deployment, security, operations, staff process, custom domain |

## Develop

```bash
npm ci
npm test                  # unit + contract + API + security tests
npm run build:e2e && npx playwright test   # full-stack browser tests
npm run test:load         # capacity model
node tests/stack/dev-stack.mjs             # local stack: http://127.0.0.1:4173/findback-campus/
```

Local development uses `APP_ENV=development` (in-memory or emulated store, a "Development sign-in" for staff, demo complaint **1223** / PIN `1223-1223-12` in memory mode). None of this exists in production builds of the Worker.

## Deploy

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Workflows: `ci.yml`, `deploy-pages.yml`, `deploy-worker.yml`, `android.yml`.

## Capacity

See **[docs/OPERATIONS.md](docs/OPERATIONS.md#capacity)**. Short version: comfortably handles 10,000 daily visitors; it does **not** support thousands of simultaneous authenticated requests, because Apps Script allows ~30 concurrent executions and serialises writes.
