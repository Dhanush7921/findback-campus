// Minimal in-process fake of the Google Sheets v4 values API and Cloud Storage JSON API, for SheetsStore tests.
import { TABLES } from '../../shared/domain';

export function createFakeGoogle(opts: { headers?: boolean } = {}) {
  const sheets: Record<string, string[][]> = {};
  for (const [t, cols] of Object.entries(TABLES)) sheets[t] = opts.headers === false ? [] : [[...cols]];
  const objects = new Map<string, { mime: string; bytes: Uint8Array }>();
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const parseRange = (r: string) => {
    const [t, a1] = decodeURIComponent(r).split('!');
    const m = /^A(\d+)?(?::[A-Z]+(\d+)?)?$/.exec(a1 ?? 'A1');
    return { t, row: m?.[1] ? Number(m[1]) : 1 };
  };
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (!String((init.headers as Record<string, string>)?.authorization ?? '').startsWith('Bearer ')) return json({}, 401);
    const p = url.pathname;
    const titles = Object.keys(sheets);
    if (/\/spreadsheets\/[^/:]+$/.test(p) && method === 'GET') {
      return json({ sheets: titles.map((title, i) => ({ properties: { sheetId: 100 + i, title } })) });
    }
    if (p.endsWith(':batchUpdate') && !p.includes('/values')) {
      const body = JSON.parse(String(init.body)) as { requests: any[] };
      const val = (row: any) => row.values.map((v: any) => v.userEnteredValue.stringValue as string);
      for (const r of body.requests) {
        if (r.appendCells) sheets[titles[r.appendCells.sheetId - 100]].push(...r.appendCells.rows.map(val));
        if (r.updateCells) sheets[titles[r.updateCells.start.sheetId - 100]][r.updateCells.start.rowIndex] = val(r.updateCells.rows[0]);
      }
      return json({});
    }
    if (p.endsWith('/values:batchGet')) {
      return json({ valueRanges: url.searchParams.getAll('ranges').map((r) => ({ values: sheets[parseRange(r).t] ?? [] })) });
    }
    if (p.includes('/values/') && p.endsWith(':append')) {
      const t = parseRange(p.split('/values/')[1].replace(':append', '')).t;
      const body = JSON.parse(String(init.body)) as { values: string[][] };
      sheets[t].push(...body.values);
      return json({ updates: { updatedRows: body.values.length } });
    }
    if (p.endsWith('/values:batchUpdate')) {
      const body = JSON.parse(String(init.body)) as { data: { range: string; values: string[][] }[] };
      for (const d of body.data) { const { t, row } = parseRange(d.range); sheets[t][row - 1] = d.values[0]; }
      return json({});
    }
    if (p.startsWith('/upload/storage/v1/b/')) {
      const name = url.searchParams.get('name')!;
      const raw = init.body as Uint8Array | string;
      objects.set(name, { mime: (init.headers as Record<string, string>)['content-type'], bytes: typeof raw === 'string' ? new TextEncoder().encode(raw) : raw });
      return json({ name });
    }
    const obj = /^\/storage\/v1\/b\/[^/]+\/o\/(.+)$/.exec(p);
    if (obj) {
      const name = decodeURIComponent(obj[1]);
      if (method === 'DELETE') { objects.delete(name); return new Response(null, { status: 204 }); }
      const o = objects.get(name);
      return o ? new Response(o.bytes, { headers: { 'content-type': o.mime } }) : json({ error: 'not found' }, 404);
    }
    return json({ error: 'unhandled ' + p }, 400);
  };
  return { sheets, objects, calls, fetchImpl: fetchImpl as typeof fetch };
}
