// Local full stack: emulated Apps Script (real Code.gs) <- Cloudflare Worker (wrangler dev / workerd) <- built frontend (vite preview).
// Usage: node tests/stack/dev-stack.mjs [--no-web]
import { spawn } from 'node:child_process';
import { startGasServer } from '../gas/emulator.mjs';

const GAS_PORT = Number(process.env.GAS_PORT ?? 8790);
const API_PORT = Number(process.env.API_PORT ?? 8787);
const latencyMs = Number(process.env.GAS_LATENCY_MS ?? 0);
const { url, runtime } = await startGasServer({ port: GAS_PORT, latencyMs });
console.log(`[stack] Apps Script emulator on ${url} (latency ${latencyMs}ms)`);

const vars = {
  APP_ENV: 'development',
  DEV_STAFF_LOGIN: '1',
  GAS_URL: url,
  GAS_SHARED_SECRET: runtime.secret,
  ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173,http://localhost:5173',
};
const args = ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--env', 'dev', '--port', String(API_PORT), '--ip', '127.0.0.1', '--log-level', 'warn'];
for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
const procs = [spawn('npx', args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })];
if (!process.argv.includes('--no-web')) {
  procs.push(spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1', '--strictPort'], { stdio: 'inherit', env: { ...process.env, VITE_BASE: '/findback-campus/' } }));
}
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
