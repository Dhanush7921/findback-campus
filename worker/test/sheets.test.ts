import { describe, expect, it } from 'vitest';
import { SheetsStore } from '../src/store/sheets';
import { createFakeGoogle } from '../../tests/gcp/fake-google';
import { TINY_JPEG } from './helpers';

const make = (g = createFakeGoogle(), refreshMs = 60_000) =>
  ({ g, store: new SheetsStore('sheet123', 'bucket1', async () => 'tok', { fetchImpl: g.fetchImpl, refreshMs }) });

describe('SheetsStore (Google Sheets API + Cloud Storage)', () => {
  it('persists appends and updates to the sheet and reloads them in a fresh instance', async () => {
    const { g, store } = make();
    await store.exec([{ op: 'append', table: 'Found_Items', row: { item_id: 'FI-1', created_at: 't', item_name: '=HYPERLINK("x")', version: '1' } }]);
    await store.exec([{ op: 'update', table: 'Found_Items', value: 'FI-1', patch: { status: 'Matched' } }]);
    const row = g.sheets.Found_Items[1];
    expect(row[0]).toBe('FI-1');
    expect(row[5]).toBe(`'=HYPERLINK("x")`); // formula injection escaped exactly like the Apps Script layer
    expect(row[3]).toBe('Matched');
    const fresh = new SheetsStore('sheet123', 'bucket1', async () => 'tok', { fetchImpl: g.fetchImpl });
    const [r] = await fresh.exec([{ op: 'get', table: 'Found_Items', value: 'FI-1' }]);
    expect(r.ok && r.row?.item_name).toBe('=HYPERLINK("x")');
    expect(r.ok && r.row?.version).toBe('2');
  });

  it('serves reads from cache (one batchGet), writes go straight to the sheet', async () => {
    const { g, store } = make();
    for (let i = 0; i < 20; i++) await store.exec([{ op: 'query', table: 'Complaints' }]);
    expect(g.calls.filter((c) => c.endsWith('values:batchGet')).length).toBe(1);
  });

  it('refuses to run against a sheet whose headers do not match (never rewrites them)', async () => {
    const g = createFakeGoogle();
    g.sheets.Complaints[0][3] = 'something_else';
    const { store } = make(g);
    expect(await store.ping()).toBe(false);
    expect(g.sheets.Complaints[0][3]).toBe('something_else');
  });

  it('stores photos privately in Cloud Storage and only serves photos/<uuid> ids', async () => {
    const { g, store } = make();
    const id = await store.uploadFile('a.jpg', 'image/jpeg', TINY_JPEG);
    expect(id).toMatch(/^photos\/[0-9a-f-]{36}$/);
    expect((await store.getFile(id))?.dataBase64).toBe(TINY_JPEG);
    expect(await store.getFile('backups/x.json')).toBeNull();
    expect(g.objects.size).toBe(1);
  });

  it('redacts personal data after retention and writes backups to the bucket', async () => {
    const { g, store } = make();
    await store.exec([{ op: 'append', table: 'Complaints', row: { complaint_id: 'FB-1', created_at: 't', status: 'Closed', name: 'Asha', phone: '999', retention_until: '2000-01-01T00:00:00Z', version: '1' } }]);
    expect(await store.retentionSweep()).toBe(1);
    expect(g.sheets.Complaints[1][5]).toBe('[redacted]');
    const b = await store.backup();
    expect(g.objects.has(b.backupId)).toBe(true);
  });

});
