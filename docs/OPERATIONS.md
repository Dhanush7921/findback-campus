# Operations

## Backups & recovery
- **Automatic**: `dailyBackup` copies the spreadsheet into *FindBack Backups (private)* at 02:00 daily, keeping 14 copies. Admins can trigger one from **Staff → Settings → Create backup now**.
- **Restore**: open the chosen backup in Drive and copy the affected rows (or a whole tab) back into the live sheet. If the live spreadsheet is lost, set the Apps Script property `FB_SPREADSHEET_ID` to a backup copy's ID (Project settings → Script properties) — the web app then serves from it immediately.
- **Export**: *File → Download → .xlsx/.csv* from the private sheet (staff with sheet access only). Treat exports as personal data.
- **Lost PINs**: never recoverable. Staff verify the student in person and use *Complaint → Staff-assisted PIN reset*; the old PIN and sessions stop working and the action is logged.

## Retention
- When a complaint becomes Returned or Closed, `retention_until` = now + `retention_days` (Settings, default 180).
- `retentionSweep` (03:00 daily) replaces name, student ID, phone, email, ownership evidence and extra info with `[redacted]` and trashes the photo; anonymous fields remain for analytics.
- Unclaimed found items appear under **Staff → Unclaimed items** after `unclaimed_days` (default 60) for documented donation/disposal.

## Failure behaviour
- Apps Script busy / quota / outage → Worker retries with jittered backoff (3 attempts), then returns `503` with a clear message. The frontend never shows success unless the Worker confirmed the write. Submissions carry an idempotency key, so retries cannot create duplicates (a replay returns the same Complaint ID with a fresh PIN because the first was never seen).
- Concurrent edits use optimistic versions (`version` column) → `409 conflict` asks staff to refresh.

## Capacity

Measured with `npm run test:load` against the real Worker code and the real `Code.gs` in the emulator, **modelling** Apps Script with ~900 ms per call (±25 %), a 30-simultaneous-execution cap and serialised writes (`docs/load-results-local.json`). Google's real latency varies (often 0.5–2 s); re-run with `--target` against the live API to measure it.

| Scenario | Concurrency | Throughput | p50 | p97.5 | Errors |
|---|---|---|---|---|---|
| Authenticated portal read | 10 | 10.8 req/s | 890 ms | 1.1 s | 0 |
| Authenticated portal read | 30 | 31.8 req/s | 907 ms | 1.1 s | 0 |
| Authenticated portal read | 60 | 37.4 req/s | 985 ms | 4.4 s | 17 % 503 |
| Complaint submission (write) | 5 | 1.1 req/s | 4.1 s | 5.5 s | 0 |
| Complaint submission (write) | 20 | 0.4 req/s | 7.0 s | 9.6 s | client timeouts at 10 s |

**Safe operating envelope (modelled): ≈30 portal reads/s and ≈1 write/s sustained.**
10,000 daily visitors is a few hundred complaints and a few thousand portal views a day — peak hour well under 5 reads/s and 0.2 writes/s — so it fits with large headroom. Static pages are served from GitHub's CDN and do not touch Apps Script at all.

**Not supported:** thousands of *simultaneous* authenticated requests. Beyond ~30 concurrent reads users get "service busy, retry"; a burst of more than ~10 simultaneous submissions queues for several seconds.

**Release blockers for heavy peaks** (e.g. a campus-wide event): none for normal use. If measured live traffic approaches the envelope, the approved migration path is to keep the Worker and frontend unchanged and swap the `Store` implementation for one that calls the Google Sheets API directly with a service account (parallel reads, batched writes) plus a short-lived Worker KV cache for non-personal reads. Moving off Google Sheets to a database would require your explicit approval.

## Monitoring
- `GET /api/health` (configured + Sheet reachable). Use any uptime monitor.
- Cloudflare dashboard → Workers → `findback-api` → Logs/Analytics for status codes and latency.
- Apps Script → Executions for data-layer errors and quota messages.
