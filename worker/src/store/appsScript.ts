import { hmacHex } from '../crypto';
import { StoreError, type FileData, type Op, type OpResult, type Store } from './types';

interface GasResponse { ok: boolean; error?: string; results?: OpResult[]; fileId?: string; mime?: string; dataBase64?: string; backupId?: string; name?: string }

/**
 * Talks to the Apps Script web app with HMAC-signed envelopes.
 * Retries transient failures (network, 429/5xx, lock contention) with jittered backoff.
 * Writes are only retried when the batch is idempotent at the data layer
 * (unique keys reject duplicates), which every caller here guarantees.
 */
export class AppsScriptStore implements Store {
  constructor(
    private url: string,
    private secret: string,
    private opts: { timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch } = {},
  ) {}

  private async call(body: object): Promise<GasResponse> {
    const retries = this.opts.retries ?? 3;
    const f = this.opts.fetchImpl ?? fetch;
    let lastErr: StoreError = new StoreError('unavailable');
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(4000, 250 * 2 ** attempt) * (0.5 + Math.random())));
      const ts = Date.now();
      const nonce = crypto.randomUUID();
      const payload = JSON.stringify(body);
      const sig = await hmacHex(this.secret, `${ts}.${nonce}.${payload}`);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 25000);
      try {
        const res = await f(this.url, {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ ts, nonce, body: payload, sig }),
          redirect: 'follow',
          signal: ctrl.signal,
        });
        if (res.status === 429) { lastErr = new StoreError('quota'); continue; }
        if (res.status >= 500) { lastErr = new StoreError('unavailable', `upstream ${res.status}`); continue; }
        const text = await res.text();
        let json: GasResponse;
        try {
          json = JSON.parse(text);
        } catch {
          // Apps Script returns HTML pages for quota/"service invoked too many times" errors.
          lastErr = new StoreError(/too many times|quota|limit/i.test(text) ? 'quota' : 'unavailable', 'non-JSON upstream');
          continue;
        }
        if (!json.ok) {
          if (json.error === 'busy') { lastErr = new StoreError('busy'); continue; }
          if (json.error === 'not_configured' || json.error === 'not_setup') throw new StoreError('not_configured');
          if (json.error === 'stale' || json.error === 'replay') { lastErr = new StoreError('unavailable', json.error); continue; }
          if (json.error === 'internal' && /too many|quota|limit exceeded/i.test(JSON.stringify(json))) { lastErr = new StoreError('quota'); continue; }
          throw new StoreError('rejected', json.error);
        }
        return json;
      } catch (e) {
        if (e instanceof StoreError && (e.code === 'not_configured' || e.code === 'rejected')) throw e;
        lastErr = e instanceof StoreError ? e : new StoreError('unavailable', String(e));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async exec(ops: Op[]): Promise<OpResult[]> {
    const r = await this.call({ action: 'exec', ops });
    return r.results ?? [];
  }
  async uploadFile(name: string, mime: string, dataBase64: string): Promise<string> {
    const r = await this.call({ action: 'uploadFile', name, mime, dataBase64 });
    if (!r.fileId) throw new StoreError('rejected', 'upload failed');
    return r.fileId;
  }
  async getFile(fileId: string): Promise<FileData | null> {
    try {
      const r = await this.call({ action: 'getFile', fileId });
      return r.mime && r.dataBase64 ? { mime: r.mime, dataBase64: r.dataBase64 } : null;
    } catch (e) {
      if (e instanceof StoreError && e.code === 'rejected') return null;
      throw e;
    }
  }
  async backup() {
    const r = await this.call({ action: 'backup' });
    return { backupId: r.backupId ?? '', name: r.name ?? '' };
  }
  async ping() {
    try {
      await this.call({ action: 'ping' });
      return true;
    } catch {
      return false;
    }
  }
}
