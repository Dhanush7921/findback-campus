# Connecting a custom domain

Example names use `lostfound.example.edu` (frontend) and `api.lostfound.example.edu` (API). Substitute your own.

## Frontend (GitHub Pages)
1. DNS: add a `CNAME` record `lostfound` → `<owner>.github.io`. (Apex domain: `A` records to 185.199.108.153, .109.153, .110.153, .111.153.)
2. Repo variables: `CUSTOM_DOMAIN` = `lostfound.example.edu`, `VITE_BASE` = `/`.
3. Settings → Pages → Custom domain → enter it → wait for the certificate → tick **Enforce HTTPS**.
4. Re-run *Deploy frontend*.

## API (Cloudflare)
1. Add the domain's zone to Cloudflare (or use a subdomain on an existing zone).
2. Workers & Pages → `findback-api` → Settings → Domains & Routes → **Add custom domain** `api.lostfound.example.edu`.
3. Variables: `VITE_API_BASE` = `https://api.lostfound.example.edu`, `EXTRA_ORIGINS` = `https://lostfound.example.edu`.
4. Re-run both workflows. Add the new origin to the Google OAuth client's authorised JavaScript origins.
