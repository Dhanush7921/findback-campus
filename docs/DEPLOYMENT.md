# Deployment

Order: **1 Apps Script → 2 Cloudflare Worker → 3 GitHub Pages → 4 Staff sign-in (optional but required for staff use) → 5 Android signing (optional)**.
Nothing secret is ever committed. Secrets live in Apps Script properties, GitHub encrypted secrets and Cloudflare Worker secrets.


## Quick path: deploy the API from your own computer (no API tokens)

After the Apps Script step, run in the repo folder (Node 22+):

```
npm ci
npm run deploy:backend
```

It opens your browser for Cloudflare sign-in, deploys the Worker, asks for `GAS_URL` and `GAS_SHARED_SECRET` in a hidden prompt
(stored only in Cloudflare), generates `PIN_PEPPER`/`SESSION_KEY` if absent (never replaced), checks `/api/health`, then uses the
GitHub CLI (browser sign-in) to set `VITE_API_BASE` and rebuild the website. Re-run with `-- --reset-gas` to change the Apps Script values.

## 1. Apps Script (data layer)

1. Open the FindBack spreadsheet (signed in as the account that owns it) → **Extensions → Apps Script**.
2. Replace `Code.gs` with [`apps-script/Code.gs`](../apps-script/Code.gs). In **Project Settings** tick *Show "appsscript.json"* and replace it with [`apps-script/appsscript.json`](../apps-script/appsscript.json).
3. Select `setupFindBack` → **Run** → approve the permissions (Sheets, Drive, triggers). It:
   - creates the 8 tabs with headers (plain-text format, warning-protected),
   - creates private Drive folders *FindBack Media (private)* and *FindBack Backups (private)*,
   - installs daily backup (02:00) and retention (03:00) triggers,
   - generates the shared secret. Run `showSharedSecret()` and copy the value into the `GAS_SHARED_SECRET` GitHub secret (step 2), then clear the log.
4. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL → GitHub secret `GAS_URL`.
   "Anyone" is required so the Worker can call it; every request must carry a valid HMAC signature made with `GAS_SHARED_SECRET`, or it is rejected.
5. Keep the spreadsheet and both folders **private** (do not use "Anyone with the link").

## 2. Cloudflare Worker (API)

1. Create a free Cloudflare account. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**. Note your **Account ID** (Workers & Pages overview).
2. In GitHub → repo **Settings → Secrets and variables → Actions → Secrets**, add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from above |
| `CLOUDFLARE_ACCOUNT_ID` | account ID |
| `GAS_URL` | Apps Script `/exec` URL |
| `GAS_SHARED_SECRET` | from the setup log |
| `PIN_PEPPER` | optional — if absent, the deploy generates it once inside Cloudflare and never replaces it (changing it invalidates every PIN) |
| `SESSION_KEY` | optional — generated inside Cloudflare like `PIN_PEPPER` |
| `GOOGLE_CLIENT_ID` | step 4 (optional until staff go live) |
| `TURNSTILE_SECRET` | optional Cloudflare Turnstile secret |

3. **Actions → Deploy API (Cloudflare Worker) → Run workflow.** It deploys `findback-api`, pushes secrets with `wrangler secret bulk`, and fails unless `/api/health` reports the Sheet reachable. Copy the printed `https://findback-api.<subdomain>.workers.dev` URL.

## 3. GitHub Pages (frontend)

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. `VITE_API_BASE` is set automatically: the API deploy rebuilds the site with the Worker URL (an optional repository variable `VITE_API_BASE` overrides it, e.g. for a custom API domain).
3. **Actions → Deploy frontend (GitHub Pages) → Run workflow** (also runs on every push to `main`).
   Site: `https://<owner>.github.io/findback-campus/`. SPA deep links work via `404.html`.

## 4. Staff sign-in (Google Workspace)

1. Google Cloud console → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised JavaScript origins: `https://<owner>.github.io` (plus your custom domain later). No redirect URI needed.
2. Secret `GOOGLE_CLIENT_ID` = the client ID.
3. Variables: `STAFF_EMAILS` = `head@college.edu:admin,clerk@college.edu:staff`; optional `STAFF_DOMAIN` = `college.edu` (only accounts of that Workspace domain).
4. Re-run the Worker workflow. Until `GOOGLE_CLIENT_ID` **and** `STAFF_EMAILS` are set, every `/api/staff/*` endpoint returns `503 staff_disabled` and the console shows "Staff access is not enabled".

## 5. Android

- Every push builds a **debug APK** artifact (Actions → Android build → artifacts).
- Signed release: generate a keystore yourself (`keytool -genkeypair -v -keystore findback.jks -alias findback -keyalg RSA -keysize 4096 -validity 10000`), then add secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 findback.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Keep the keystore offline; losing it means you cannot update the Play Store app.
- iOS: `npx cap sync ios` then open `ios/App/App.xcodeproj` in Xcode on a Mac (Apple Developer account needed).

## Optional hardening

- **Turnstile**: create a widget in Cloudflare (domain = your Pages host), set variable `TURNSTILE_SITE_KEY` and secret `TURNSTILE_SECRET`, redeploy the Worker. The form then requires the check.
- **Rotate the shared secret**: run `rotateSharedSecret()` in Apps Script, update `GAS_SHARED_SECRET`, re-run the Worker workflow.

## Custom domain (later)

See [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md).
