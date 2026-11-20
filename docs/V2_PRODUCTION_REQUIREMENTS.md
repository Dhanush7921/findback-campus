# FindBack V2 production requirements

## Implemented in this branch

- Student and Guest phone-OTP session exchange with server-side Firebase ID-token validation.
- Student verification against protected `student_registry:<student-id>` records stored in the existing `Application_Settings` tab. Registry records contain JSON with `studentId`, `phoneE164`, `name`, `department` and `active`.
- Authenticated complaint attribution using Firebase UID and verified E.164 phone number. Form identity fields are not authoritative.
- Own-complaint listing and detail APIs with direct cross-account denial.
- Main Admin operational APIs and a separate read-only Management API namespace.
- Management pages: Executive Overview, Analytics & Trends, Campus Hotspots, Audit Trail, Policies & Security.
- Short-lived, single-use handover challenges. Receiver acknowledgment and staff physical-release confirmation are stored separately; `Returned` is set only after both exist.
- Proxy collection records actual receiver identity plus owner authorization.
- Extended append-only audit metadata: actor role, before/after state, authorization outcome and evidence reference.
- Append-only spreadsheet schema migration that preserves all eight existing tabs and rows.

## Required before production OTP testing

1. Select the Google Cloud project and enable Firebase Authentication or Identity Platform phone sign-in.
2. Register a Web app and set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN` and `FIREBASE_APP_ID` before deployment.
3. Configure authorised origins and Android SHA fingerprints in Firebase.
4. Provide the approved college student registry. It must be imported as protected `student_registry:*` rows; do not accept self-registration as proof of student status.
5. Set `GOOGLE_CLIENT_ID`, `STAFF_DOMAIN` and `STAFF_EMAILS`. Roles are `admin`, `staff`, and `management`.
6. Complete Google Cloud billing/IAM approval and share the private Sheet with the generated Cloud Run service identity.

## Release gates

- Real-device Student OTP and Guest OTP pass.
- Cross-account complaint reads return 404/403 at the API, not only in the UI.
- Management sessions can call only the read-only Management endpoints and are rejected by operational staff endpoints.
- Receiver code expires, is single-use, and cannot mark an item Returned without staff confirmation.
- Sheet migration has completed and `/api/health` reports `storeReachable: true`.
- Private media cannot be opened without an authorised application session.
- Load test results and Google Sheets write bottlenecks are recorded; do not claim unlimited concurrency.
- Debug APK installs and uses the same verified Cloud Run API.
