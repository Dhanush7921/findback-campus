// Runs the real apps-script/Code.gs inside a Node VM with faithful-enough mocks of
// SpreadsheetApp, DriveApp, LockService, CacheService, PropertiesService and Utilities.
// Used by contract/integration tests and the local full-stack harness. Not a Google product.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, '../../apps-script/Code.gs'), 'utf8');

function makeSheet(name) {
  const data = []; // rows of arrays (1-based in API)
  let maxRows = 1000;
  let maxCols = 26;
  const cellText = (v) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
  const sheet = {
    name,
    data,
    getName: () => name,
    getLastRow: () => data.length,
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxCols,
    insertColumnsAfter: (_a, n) => { maxCols += n; },
    setFrozenRows: () => sheet,
    getProtections: () => [],
    protect: () => ({ setDescription() { return this; }, setWarningOnly() { return this; } }),
    appendRow(values) {
      // Mimic Sheets: a leading apostrophe is a text marker and is not returned by getValues.
      data.push(values.map((v) => { const s = cellText(v); return s.startsWith("'") ? s.slice(1) : s; }));
      return sheet;
    },
    getRange(row, col, numRows = 1, numCols = 1) {
      const range = {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = data[row - 1 + r] ?? [];
            const line = [];
            for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          for (let r = 0; r < values.length; r++) {
            const idx = row - 1 + r;
            while (data.length <= idx) data.push([]);
            for (let c = 0; c < values[r].length; c++) {
              const s = cellText(values[r][c]);
              data[idx][col - 1 + c] = s.startsWith("'") ? s.slice(1) : s;
            }
          }
          return range;
        },
        setFontWeight: () => range,
        setBackground: () => range,
        setNumberFormat: () => range,
        createTextFinder(text) {
          let entire = false;
          let mc = false;
          const finder = {
            matchEntireCell(v) { entire = v; return finder; },
            matchCase(v) { mc = v; return finder; },
            findAll() {
              const hits = [];
              for (let r = 0; r < numRows; r++) {
                for (let c = 0; c < numCols; c++) {
                  const v = String(data[row - 1 + r]?.[col - 1 + c] ?? '');
                  const a = mc ? v : v.toLowerCase();
                  const b = mc ? text : String(text).toLowerCase();
                  if (entire ? a === b : a.includes(b)) hits.push({ getRow: () => row + r, getColumn: () => col + c });
                }
              }
              return hits;
            },
            findNext() { return finder.findAll()[0] ?? null; },
          };
          return finder;
        },
      };
      return range;
    },
  };
  return sheet;
}

export function createGasRuntime({ latencyMs = 0 } = {}) {
  const sheets = new Map();
  const props = new Map();
  const cache = new Map();
  const files = new Map();
  const logs = [];
  let lockHeld = Promise.resolve();
  const toSigned = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const fromSigned = (arr) => Buffer.from(arr.map((b) => (b + 256) % 256));
  const spreadsheet = {
    getId: () => 'SPREADSHEET_EMU',
    getSheetByName: (n) => sheets.get(n) ?? null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
  };
  const folder = (id) => ({
    getId: () => id,
    createFile(blob) {
      const fid = 'f' + crypto.randomBytes(12).toString('hex');
      files.set(fid, { ...blob, parent: id, trashed: false, created: Date.now() });
      return { getId: () => fid, getName: () => blob.name };
    },
    getFiles() {
      const list = [...files.entries()].filter(([, f]) => f.parent === id && !f.trashed);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => { const [fid, f] = list[i++]; return { getDateCreated: () => f.created, setTrashed: (t) => { f.trashed = t; }, getId: () => fid }; } };
    },
  });
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {}, ProtectionType: { SHEET: 'SHEET' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => { props.set(k, String(v)); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; }, put: (k, v, s) => cache.set(k, { v, exp: Date.now() + s * 1000 }) }) },
    LockService: {
      getScriptLock() {
        // Lock state is held by the async harness (see exec below); the VM code is synchronous.
        return { tryLock: () => true, waitLock() {}, releaseLock() {} };
      },
    },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (msg, key) => toSigned(crypto.createHmac('sha256', key).update(msg, 'utf8').digest()),
      computeDigest: (_alg, s) => toSigned(crypto.createHash('sha256').update(String(s)).digest()),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      base64Encode: (arr) => fromSigned(arr).toString('base64'),
      base64EncodeWebSafe: (arr) => fromSigned(arr).toString('base64url'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString(),
    },
    DriveApp: {
      createFolder: () => folder('folder_' + crypto.randomBytes(4).toString('hex')),
      getFolderById: (id) => folder(id),
      getFileById(fid) {
        if (fid === 'SPREADSHEET_EMU') return { makeCopy: (n) => ({ getId: () => 'backup_' + Date.now(), getName: () => n }) };
        const f = files.get(fid);
        if (!f || f.trashed) throw new Error('not found');
        return {
          getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => f.parent }; } }; },
          getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes }),
          setTrashed: (t) => { f.trashed = t; },
        };
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, create() {} }) },
    Logger: { log: (m) => logs.push(String(m)) },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'Code.gs' });
  sandbox.setupFindBack();

  return {
    secret: props.get('FB_SHARED_SECRET'),
    sheets,
    files,
    logs,
    sandbox,
    /** Serialises executions like Apps Script's script lock + adds optional latency. */
    async doPost(raw) {
      // Reads run concurrently (like parallel Apps Script executions); writes queue on the script lock.
      let writes = false;
      try { writes = /"op":"(append|update)"|"action":"(uploadFile|backup)"/.test(JSON.parse(raw).body); } catch { /* bad envelope */ }
      const latency = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs * (0.75 + Math.random() * 0.5))) : null);
      if (!writes) { await latency(); return sandbox.doPost({ postData: { contents: raw } }).content; }
      const run = async () => {
        await latency();
        return sandbox.doPost({ postData: { contents: raw } }).content;
      };
      const p = lockHeld.then(run, run);
      lockHeld = p.catch(() => undefined);
      return p;
    },
  };
}

/** Starts an HTTP server emulating the Apps Script /exec endpoint. */
export function startGasServer({ port = 0, latencyMs = 0, maxConcurrent = 30 } = {}) {
  const rt = createGasRuntime({ latencyMs });
  let active = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.method === 'GET') { res.end(JSON.stringify({ ok: true })); return; }
      if (active >= maxConcurrent) {
        // Apps Script rejects beyond ~30 simultaneous executions per user with an HTML error page.
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>Service invoked too many times for one user</html>');
        return;
      }
      active++;
      try {
        const out = await rt.doPost(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(out);
      } finally {
        active--;
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/exec`, runtime: rt })));
}
