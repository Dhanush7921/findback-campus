# Operations

## Backups and recovery

- **On demand:** Main Admin can create a complete JSON snapshot from **Settings → Create backup now**. Cloud Run writes it to the private bucket under `backups/`; the API service identity is the only runtime principal with object access.
- **Scheduled backup gate:** configure an institution-approved daily scheduler before launch, then verify a backup can be restored into a copy of the Sheet. The application does not pretend a browser or scale-to-zero Cloud Run timer is a reliable scheduler.
- **Restore:** restore first into a private test spreadsheet, run the schema check and compare record counts before changing the production `SHEET_ID`. Treat every export as personal data.
- **Legacy credentials:** Complaint ID + PIN applies only to pre-V2 records. New records use verified-phone reporter sessions.

## Retention

- Returned, Closed or reporter-cancelled complaints receive `retention_until` using the configured retention period (default 180 days).
- The Cloud Run process runs a due-record sweep after startup and daily while active. A missed sweep is date-based and catches up on the next active run. Production should also invoke and monitor retention through the institution's approved scheduler.
- The sweep redacts the reporter name, student ID, phone, email, ownership evidence and extra information, and removes the complaint photo. Anonymous operational fields remain available for reporting.
- Unclaimed found items appear in the Main Admin queue after the configured period (default 60 days); donation/disposal still requires a documented staff decision.

## Failure behaviour

- Google Sheets or Cloud Storage quota/outage errors return a clear `503`; the frontend does not show success until the API confirms the write.
- Complaint submissions carry an idempotency key so a safe retry cannot create a duplicate record.
- Concurrent edits use the `version` column. A stale staff action returns `409 conflict` and must be refreshed, not silently overwritten.
- Production logs contain request IDs and authorization outcomes, not OTPs, receiver codes, ownership evidence or request bodies.

## Capacity

`npm run test:load` exercises the real API and spreadsheet contract against the controlled local latency model. The latest artifact is [`load-results-local.json`](load-results-local.json). It is a design-limit test, not proof of live Google quota or internet performance.

| Scenario | Concurrency | Throughput | p50 | p97.5 | Result |
|---|---:|---:|---:|---:|---|
| Authenticated portal read | 10 | 10.7 req/s | 896 ms | 1.11 s | 161/161 successful |
| Authenticated portal read | 30 | 32.0 req/s | 891 ms | 1.12 s | 480/480 successful |
| Authenticated portal read | 60 | 37.4 req/s | 975 ms | 4.37 s | 466 successful, 95 rate/busy responses |
| Complaint write burst | 5 | 1.1 req/s | 4.26 s | 4.87 s | 16/16 successful |
| Complaint write burst | 20 | 0.4 req/s | 6.92 s | 9.48 s | 6 successful, 30 client timeouts/errors |

The modelled safe envelope is about **30 authenticated reads/s and 1 serialized write/s sustained**. The heavy 20-writer burst is intentionally outside that envelope and fails the release target. Before launch, repeat the test against a staging Cloud Run service and a staging Sheet, record Google quota settings, and set alert thresholds from the observed p95 and error rate. Do not advertise unlimited concurrency.

Static frontend assets are served by GitHub Pages and do not consume Sheets quota. Cloud Run is deliberately limited to one instance so in-process cache and serialized writes remain coherent. A database migration or multi-instance write coordinator requires a separately approved architecture change.

## Monitoring

- Probe `GET /api/health`; require both the API and `storeReachable` to be healthy.
- Monitor Cloud Run request count, p95 latency, 4xx/5xx rate, instance count and container restarts.
- Alert on Sheets API quota failures, Cloud Storage failures, repeated authentication failures and handover authorization denials.
- Review the append-only `Activity_Log` for sensitive staff actions and Management exports.
- Perform a documented restore drill before launch and periodically afterward.
