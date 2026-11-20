#!/usr/bin/env node
// One-command backend deploy from your own computer, using browser sign-in (no API tokens to copy).
//   npm ci && npm run deploy:backend
// Steps: Cloudflare browser login -> deploy Worker -> store secrets in Cloudflare (hidden input) ->
// health check -> GitHub browser login -> set VITE_API_BASE -> rebuild the website.
// Secret values are typed into a hidden prompt and piped straight to Cloudflare; they are never printed or saved to disk
// except a 0600 temp file that is deleted immediately. Existing PIN_PEPPER / SESSION_KEY are never replaced.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const REPO = 'Dhanush7921/findback-campus';
const CFG = ['--config', 'worker/wrangler.toml'];
const WIN = process.platform === 'win32';
const ORIGINS = ['https://dhanush7921.github.io', 'https://localhost', 'capacitor://localhost', ...(process.env.EXTRA_ORIGINS ? [process.env.EXTRA_ORIGINS] : [])].join(',');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { shell: WIN, encoding: 'utf8', ...opts });
const wrangler = (args, opts) => run('npx', ['wrangler', ...args], opts);
const step = (s) => console.log(`\n=== ${s}`);
const fail = (s) => { console.error(`\n✖ ${s}`); process.exit(1); };

function hidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  });
}

step('1/6 Cloudflare sign-in');
const who = wrangler(['whoami']);
if (who.status !== 0 || /not authenticated/i.test((who.stdout || '') + (who.stderr || ''))) {
  console.log('A browser window will open. Approve the Cloudflare request there.');
  if (wrangler(['login'], { stdio: 'inherit' }).status !== 0) fail('Cloudflare login did not complete.');
}
console.log('Signed in to Cloudflare.');

step('2/6 Deploy Worker');
const dep = wrangler(['deploy', ...CFG, '--var', `ALLOWED_ORIGINS:${ORIGINS}`,
  '--var', `STAFF_EMAILS:${process.env.STAFF_EMAILS || ''}`, '--var', `STAFF_DOMAIN:${process.env.STAFF_DOMAIN || ''}`]);
process.stdout.write(dep.stdout || ''); process.stderr.write(dep.stderr || '');
if (dep.status !== 0) fail('Worker deploy failed (see above). If it asks for a workers.dev subdomain, open Workers & Pages in the Cloudflare dashboard once, then re-run.');
const url = ((dep.stdout || '') + (dep.stderr || '')).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
if (!url) fail('Deployed, but could not find the workers.dev URL in the output.');
console.log(`Worker URL: ${url}`);

step('3/6 Worker secrets (stored only in Cloudflare)');
let have = [];
try { have = JSON.parse(wrangler(['secret', 'list', ...CFG, '--format', 'json']).stdout || '[]').map((x) => x.name); } catch { /* none yet */ }
const reset = process.argv.includes('--reset-gas');
const secrets = {};
if (!have.includes('GAS_URL') || reset) {
  console.log('From Apps Script: Deploy → Manage deployments → Web app URL (ends in /exec).');
  const v = await hidden('GAS_URL (hidden): ');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)) fail('That is not an Apps Script web app URL ending in /exec.');
  secrets.GAS_URL = v;
}
if (!have.includes('GAS_SHARED_SECRET') || reset) {
  console.log('From Apps Script: run showSharedSecret() and copy the value from the Execution log.');
  const v = await hidden('GAS_SHARED_SECRET (hidden): ');
  if (v.length < 20) fail('Shared secret looks too short.');
  secrets.GAS_SHARED_SECRET = v;
}
for (const k of ['PIN_PEPPER', 'SESSION_KEY']) {
  if (!have.includes(k)) { secrets[k] = randomBytes(32).toString('base64url'); console.log(`Generated ${k} (kept in Cloudflare, never replaced).`); }
  else console.log(`${k} already set — kept.`);
}
if (Object.keys(secrets).length) {
  const dir = mkdtempSync(join(tmpdir(), 'fb-'));
  const file = join(dir, 's.json');
  try {
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    const r = wrangler(['secret', 'bulk', file, ...CFG]);
    if (r.status !== 0) fail('Saving secrets to Cloudflare failed:\n' + (r.stderr || '').replace(/[A-Za-z0-9_-]{30,}/g, '***'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`Saved: ${Object.keys(secrets).join(', ')}`);
} else console.log('All secrets already present.');

step('4/6 Health check');
let health = null;
for (let i = 0; i < 6 && !health?.storeReachable; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  try { health = await (await fetch(`${url}/api/health`)).json(); } catch { /* retry */ }
}
console.log('Health:', JSON.stringify(health));
if (!health?.storeReachable) fail('The Worker is up but cannot reach Apps Script. Check the web app is deployed with Access "Anyone", then run: npm run deploy:backend -- --reset-gas');

step('5/6 GitHub sign-in');
if (run('gh', ['--version']).status !== 0) {
  console.log(`GitHub CLI not found. Set the variable yourself: https://github.com/${REPO}/settings/variables/actions → VITE_API_BASE = ${url}`);
  console.log('(Or install it from https://cli.github.com and re-run.)');
  process.exit(0);
}
if (run('gh', ['auth', 'status']).status !== 0 && run('gh', ['auth', 'login', '--web', '-h', 'github.com'], { stdio: 'inherit' }).status !== 0) fail('GitHub login did not complete.');

step('6/6 Connect and rebuild the website');
if (run('gh', ['variable', 'set', 'VITE_API_BASE', '-b', url, '-R', REPO], { stdio: 'inherit' }).status !== 0) fail('Could not set VITE_API_BASE.');
run('gh', ['workflow', 'run', 'deploy-pages.yml', '-R', REPO, '--ref', 'main'], { stdio: 'inherit' });
console.log(`\n✔ Backend live at ${url}. The website rebuild has started: https://github.com/${REPO}/actions`);
