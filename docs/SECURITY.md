# Security model

## Trust boundaries

- **Browser / Android app:** untrusted. The API never treats hidden buttons or form identity fields as authorization.
- **Cloud Run API:** validates Firebase and Google tokens, creates short-lived signed application sessions, enforces roles, workflow transitions, rate limits, origin restrictions and audit events.
- **Google Sheets / Cloud Storage:** private. The Cloud Run service identity receives only the required Sheets and object permissions; no service-account key file is created.
- **Management:** authenticated but read-only. Management sessions are denied by all operational staff handlers even if they call the API directly.

## Principal controls

| Threat | Control |
|---|---|
| Fake student identity | Firebase phone token is verified server-side; Student access additionally requires verified phone + student ID + department to match the protected college registry. Users cannot self-assign Student, Admin or Management roles. |
| Guest misrepresentation | The UI and records say **Phone Verified Guest**. Phone control is never described as real-world identity or college-membership proof. |
| Cross-account access | Every V2 complaint read first compares the stored reporter UID with the signed session UID. Isolation is tested with direct backend requests. |
| Staff or management impersonation | Google ID token signature, issuer, audience, expiry, verified email and optional Workspace domain are checked, followed by a server-side email/role allowlist on every request. |
| Management edits | Management uses a separate GET-only API namespace. Operational staff endpoints return `403 read_only` for Management sessions; no Management mutation route exists. |
| False or duplicate handover | Claim approval, receiver acknowledgment and staff physical release are separate states. The six-digit challenge is short-lived, single-use and stored only as a keyed hash. `Returned` is impossible until receiver and staff confirmations both exist. |
| Proxy collection | The actual OTP-linked receiver identity is recorded separately from the owner. Non-owner collection requires recorded owner authorization. |
| Audit tampering | Application operations append audit rows with actor, role, timestamp, record, action, authorization result and before/after state. Normal interfaces contain no update/delete endpoint for audit rows. Sheet editor access must remain tightly restricted. |
| Spam / OTP abuse | Firebase quotas/abuse controls, API rate limits, complaint idempotency keys, minimum form time and repeat-submission detection. Optional Turnstile can supplement public forms. |
| Upload attacks | JPEG/PNG/WebP allowlist, magic-byte check, 3 MB cap, client re-encode, private object storage and authenticated streaming with `no-store`. |
| Spreadsheet injection | Control-character removal, Zod validation and formula-prefix escaping before every Sheet write. |
| Session theft | Short-lived HMAC-signed sessions are stored in `sessionStorage`, never URLs or localStorage. A strict CSP limits third-party script and connection origins. |
| Data leakage | API responses use `Cache-Control: no-store`; the service worker caches static assets only. Sensitive found-item details and media are never returned to public clients. |

## Residual risks and operational requirements

- Phone OTP security depends on the Firebase project, authorised origins, Android SHA configuration, quotas and billing state.
- A Sheet owner/editor can read all rows. Restrict editor access and monitor sharing changes.
- Google Sheets is the capacity bottleneck. Cloud Run serialises writes in one instance; do not advertise unlimited concurrency.
- The legacy Complaint ID + PIN routes exist only for existing V1 records during migration. New records use verified-phone identity.
- Staff-assisted phone-loss recovery must be documented and performed only after proportional in-person identity and ownership checks, with an audit event.
