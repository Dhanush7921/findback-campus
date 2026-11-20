#!/usr/bin/env node
// Append-only FindBack V2 header migration. Existing columns and rows are
// never reordered or deleted. Uses the signed-in gcloud user; no key files.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const sheetId = process.env.SHEET_ID;
if (!sheetId) throw new Error('SHEET_ID is required');
const tokenRun = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
if (tokenRun.status !== 0 || !tokenRun.stdout.trim()) throw new Error('Could not get a gcloud access token');
const token = tokenRun.stdout.trim();
const sandbox = {};
const appsScript = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
// Top-level `const` bindings in a VM are lexical rather than properties of the
// sandbox object, so explicitly expose the schema after evaluating Code.gs.
vm.runInNewContext(`${appsScript}\n;globalThis.__FB_SCHEMA__ = FB_SCHEMA;`, sandbox);
const schema = sandbox.__FB_SCHEMA__;
if (!schema || typeof schema !== 'object') throw new Error('Could not read FB_SCHEMA');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const metaRes = await fetch(`${base}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`, { headers });
if (!metaRes.ok) throw new Error(`Cannot read spreadsheet (${metaRes.status})`);
const meta = await metaRes.json();
const tabs = new Map(meta.sheets.map((s) => [s.properties.title, s.properties]));
const col = (n) => { let s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const structural = [];
for (const [title, cols] of Object.entries(schema)) {
  const p = tabs.get(title);
  if (!p) throw new Error(`Required existing tab is missing: ${title}`);
  if (p.gridProperties.columnCount < cols.length) structural.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: cols.length - p.gridProperties.columnCount } });
}
if (structural.length) {
  const r = await fetch(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ requests: structural }) });
  if (!r.ok) throw new Error(`Could not extend sheet columns (${r.status})`);
}
for (const [title, cols] of Object.entries(schema)) {
  const range = `${title}!A1:${col(cols.length)}1`;
  const read = await fetch(`${base}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, { headers });
  if (!read.ok) throw new Error(`Could not read ${title} header (${read.status})`);
  const current = ((await read.json()).values?.[0] ?? []).map(String);
  for (let i = 0; i < current.length; i++) if (current[i] && current[i] !== cols[i]) throw new Error(`${title} column ${i + 1} is ${current[i]}, expected ${cols[i]}; refusing to reorder data`);
  if (current.length >= cols.length && cols.every((c, i) => current[i] === c)) continue;
  const write = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers, body: JSON.stringify({ range, majorDimension: 'ROWS', values: [cols] }) });
  if (!write.ok) throw new Error(`Could not update ${title} header (${write.status})`);
  console.log(`Extended ${title}: ${current.length} -> ${cols.length} columns`);
}
console.log('FindBack V2 sheet schema is ready; existing rows were preserved.');
