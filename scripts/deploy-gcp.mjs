#!/usr/bin/env node
// One-command deploy of the FindBack API to Google Cloud Run (asia-south1), using browser sign-in only.
//   npm run deploy:gcp
// No service-account key files are created. Secrets live in Secret Manager; PIN_PEPPER / SESSION_KEY are generated once
// and never rotated by this script. Billing is linked only after you type "yes".
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';

const REPO = 'Dhanush7921/findback-campus';
const SHEET_ID = '1hxlYTgj99bMlkx4xWVWVmkUvqfQxWGsu704t-DHygvU';
const REGION = 'asia-south1';
const SERVICE = 'findback-api';
const ORIGINS = ['https://dhanush7921.github.io', 'https://localhost', 'capacitor://localhost', ...(process.env.EXTRA_ORIGINS ? [process.env.EXTRA_ORIGINS] : [])].join(',');
const WIN = process.platform === 'win32';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { shell: WIN, encoding: 'utf8', ...opts });
const gc = (args, opts) => sh('gcloud', args, opts);
const out = (args) => { const r = gc(args); return r.status === 0 ? r.stdout.trim() : ''; };
const must = (args, what) => { const r = gc(args, { stdio: 'inherit' }); if (r.status !== 0) fail(`${what} failed (see above).`); };
const step = (s) => console.log(`\n=== ${s}`);
function fail(s) { console.error(`\n✖ ${s}`); process.exit(1); }

step('1/9 Google Cloud CLI');
if (gc(['--version']).status !== 0) fail('gcloud is not installed. Install it from https://cloud.google.com/sdk/docs/install, open a new terminal, and re-run.');
if (!out(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'])) {
  console.log('A browser window will open. Review and approve the Google Cloud sign-in there.');
  must(['auth', 'login'], 'Google sign-in');
}
console.log(`Signed in as ${out(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'])}`);

step('2/9 Project');
let project = process.env.GCP_PROJECT || out(['config', 'get-value', 'project']);
const existing = out(['projects', 'list', '--format=value(projectId)']).split(/\s+/).filter(Boolean);
if (!project || !existing.includes(project)) {
  const a = (await ask(`Project ID to use or create [findback-campus-${randomBytes(2).toString('hex')}]: `)).trim();
  project = a || `findback-campus-${randomBytes(2).toString('hex')}`;
  if (!existing.includes(project)) must(['projects', 'create', project, '--name=FindBack'], 'Project creation');
}
must(['config', 'set', 'project', project], 'Selecting project');
console.log(`Using project ${project}`);

step('3/9 Billing (Cloud Run needs a billing account; FindBack normally stays in the free tier)');
if (out(['billing', 'projects', 'describe', project, '--format=value(billingEnabled)']) !== 'True') {
  const accounts = out(['billing', 'accounts', 'list', '--filter=open=true', '--format=value(name,displayName)']).split('\n').filter(Boolean);
  if (!accounts.length) fail('No billing account found. Create one at https://console.cloud.google.com/billing, then re-run.');
  accounts.forEach((a, i) => console.log(`  [${i + 1}] ${a.replace('\t', '  ')}`));
  const pick = Number((await ask('Billing account number to link: ')).trim() || '1') - 1;
  const acct = accounts[pick]?.split('\t')[0];
  if (!acct) fail('Invalid choice.');
  if ((await ask(`Link billing account ${acct} to ${project}? Type "yes" to approve: `)).trim().toLowerCase() !== 'yes') fail('Billing not approved; nothing else was changed.');
  must(['billing', 'projects', 'link', project, `--billing-account=${acct.replace('billingAccounts/', '')}`], 'Linking billing');
}
console.log('Billing enabled.');

step('4/9 Enable APIs');
must(['services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com',
  'secretmanager.googleapis.com', 'sheets.googleapis.com', 'storage.googleapis.com', 'iam.googleapis.com'], 'Enabling APIs');

step('5/9 Service account (least privilege, no key files)');
const sa = `${SERVICE}@${project}.iam.gserviceaccount.com`;
if (!out(['iam', 'service-accounts', 'describe', sa, '--format=value(email)'])) {
  must(['iam', 'service-accounts', 'create', SERVICE, '--display-name=FindBack API (Cloud Run)'], 'Creating service account');
}
console.log(`Service account: ${sa}`);

step('6/9 Private storage bucket and secrets');
const bucket = `${project}-findback-private`;
if (gc(['storage', 'buckets', 'describe', `gs://${bucket}`]).status !== 0) {
  must(['storage', 'buckets', 'create', `gs://${bucket}`, `--location=${REGION}`, '--uniform-bucket-level-access', '--public-access-prevention'], 'Creating bucket');
}
must(['storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`, `--member=serviceAccount:${sa}`, '--role=roles/storage.objectAdmin', '--quiet'], 'Bucket access');
for (const name of ['PIN_PEPPER', 'SESSION_KEY']) {
  if (gc(['secrets', 'describe', name]).status !== 0) {
    // Value is piped on stdin; it is never printed or written to disk.
    const r = gc(['secrets', 'create', name, '--replication-policy=automatic', '--data-file=-'], { input: randomBytes(32).toString('base64url') });
    if (r.status !== 0) fail(`Creating secret ${name} failed: ${r.stderr}`);
    console.log(`Created ${name} (random, stored only in Secret Manager).`);
  } else console.log(`${name} already exists — kept unchanged.`);
  must(['secrets', 'add-iam-policy-binding', name, `--member=serviceAccount:${sa}`, '--role=roles/secretmanager.secretAccessor', '--quiet'], `Secret access for ${name}`);
}

step('7/9 Share the spreadsheet with the service account');
console.log(`Open https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit → Share → add\n  ${sa}\nas Editor (untick "Notify people"), then press Enter here.`);
await ask('Press Enter once shared… ');

step('8/9 Deploy to Cloud Run (builds the Dockerfile with Cloud Build; takes a few minutes)');
const envVars = [`SHEET_ID=${SHEET_ID}`, `BUCKET=${bucket}`, `ALLOWED_ORIGINS=${ORIGINS}`,
  `STAFF_EMAILS=${process.env.STAFF_EMAILS || ''}`, `STAFF_DOMAIN=${process.env.STAFF_DOMAIN || ''}`, `GOOGLE_CLIENT_ID=${process.env.GOOGLE_CLIENT_ID || ''}`];
must(['run', 'deploy', SERVICE, '--source', '.', `--region=${REGION}`, `--service-account=${sa}`, '--allow-unauthenticated',
  // One instance keeps the in-memory sheet cache and write ordering consistent; see docs/OPERATIONS.md for capacity.
  '--max-instances=1', '--min-instances=0', '--concurrency=80', '--cpu=1', '--memory=512Mi', '--timeout=60',
  `--set-env-vars=^##^${envVars.join('##')}`, '--set-secrets=PIN_PEPPER=PIN_PEPPER:latest,SESSION_KEY=SESSION_KEY:latest', '--quiet'], 'Cloud Run deploy');
const url = out(['run', 'services', 'describe', SERVICE, `--region=${REGION}`, '--format=value(status.url)']);
if (!url) fail('Deployed, but could not read the service URL.');
console.log(`API URL: ${url}`);

let health = null;
for (let i = 0; i < 6 && !health?.storeReachable; i++) {
  try { health = await (await fetch(`${url}/api/health`)).json(); } catch { /* retry */ }
  if (!health?.storeReachable) await new Promise((r) => setTimeout(r, 5000));
}
console.log('Health:', JSON.stringify(health));
if (!health?.storeReachable) fail(`The API is up but cannot read the sheet. Check it is shared with ${sa} as Editor, wait a minute, and re-run.`);

step('9/9 Connect the website and Android app');
if (sh('gh', ['--version']).status !== 0) {
  console.log(`GitHub CLI not found. Add repository variable VITE_API_BASE = ${url} at https://github.com/${REPO}/settings/variables/actions`);
} else {
  if (sh('gh', ['auth', 'status']).status !== 0) sh('gh', ['auth', 'login', '--web', '-h', 'github.com'], { stdio: 'inherit' });
  if (sh('gh', ['variable', 'set', 'VITE_API_BASE', '-b', url, '-R', REPO], { stdio: 'inherit' }).status !== 0) fail('Could not set VITE_API_BASE.');
  sh('gh', ['workflow', 'run', 'deploy-pages.yml', '-R', REPO, '--ref', 'main'], { stdio: 'inherit' });
  sh('gh', ['workflow', 'run', 'android.yml', '-R', REPO, '--ref', 'main'], { stdio: 'inherit' });
}
rl.close();
console.log(`\n✔ FindBack API live on Cloud Run: ${url}\n  Website and Android builds started: https://github.com/${REPO}/actions`);
