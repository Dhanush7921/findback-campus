# FindBack — Campus Lost & Found

A production web app, installable PWA and Android/iOS app for reporting lost items on campus, tracking them through a verified-phone private portal, and releasing them only after separate receiver and staff confirmations.

- **Students and guests use Firebase phone OTP.** The backend validates Firebase ID tokens. Student access additionally requires an exact match against the approved college registry; Guest access is labelled **Phone Verified Guest**.
- **Main Admin console** handles complaints, found inventory, ownership verification, secure handover, audit and settings. Google sign-in plus a server-side allowlist protects every operation.
- **Management portal is monitoring-only.** Its APIs are separate, GET-only routes and reject management sessions on operational staff endpoints.
- **Google Sheets remains the authoritative record store** (the original eight tabs are preserved and extended); private media goes to Cloud Storage.
- **V1 Complaint ID + PIN routes remain temporarily for existing records only.** New V2 complaints never depend on a user-editable reporter field or a complaint PIN.

## Architecture

```
React + Vite + TS PWA  (GitHub Pages / Capacitor app)
        │ HTTPS, Firebase/Google identity tokens and short-lived app sessions
        ▼
Cloud Run API — Firebase/Google token validation, signed app sessions, role checks,
                rate limits, CORS, audit events, matching and workflow rules
        │ least-privilege Google APIs
        ▼
Google Sheets API + private Cloud Storage, accessed with a least-privilege
Cloud Run service identity and no downloaded service-account keys
        ▼
Private Google Sheet (8 tabs) + private Cloud Storage bucket
```

The `Store` interface (`worker/src/store/types.ts`) isolates persistence, so capacity work never touches the frontend or API contract.

| Path | What |
|---|---|
| `src/` | Frontend (public pages, student portal, staff console), i18n (English/Telugu) |
| `shared/domain.ts` | Statuses, transitions, sheet schemas, validation used by frontend **and** backend |
| `worker/` | Cloud Run API, persistence adapters and security tests |
| `apps-script/` | `Code.gs` + `appsscript.json` for the spreadsheet |
| `tests/gas/emulator.mjs` | Runs the real `Code.gs` in Node with Sheets/Drive/Lock mocks (contract + E2E tests) |
| `tests/e2e/` | Playwright browser flows against the local full stack |
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

Local development uses `APP_ENV=development` (in-memory or emulated store and explicit development sign-ins). None of the development sign-ins are enabled by the Cloud Run production entry point.

## Deploy

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Workflows: `ci.yml`, `deploy-pages.yml`, `deploy-worker.yml`, `android.yml`.

## Capacity

See **[docs/OPERATIONS.md](docs/OPERATIONS.md#capacity)**. Capacity depends on the live Google Sheets API quota and workload; run the provided load suite against staging before launch and watch Cloud Run latency and error budgets in production.
