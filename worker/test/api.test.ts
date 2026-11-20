import { describe, expect, it } from 'vitest';
import { complaintBody, gasStore, makeClient, TINY_JPEG } from './helpers';
import { MemoryStore } from '../src/store/memory';
import { SheetsStore } from '../src/store/sheets';
import { createFakeGoogle } from '../../tests/gcp/fake-google';

const devEnv = { APP_ENV: 'development', DEV_STAFF_LOGIN: '1' } as const;

async function staffToken(call: ReturnType<typeof makeClient>['call'], role = 'admin', email = 'officer@example.edu') {
  const r = await call('POST', '/api/staff/dev-session', { email, role });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

describe.each([
  ['memory', () => new MemoryStore()],
  ['apps-script emulator', () => gasStore().store],
  ['google sheets api (fake)', () => new SheetsStore('s', 'b', async () => 't', { fetchImpl: createFakeGoogle().fetchImpl })],
])('End-to-end API workflow (%s)', (_n, mkStore) => {
  it('submit → verify → match → claim → approve → handover → close', async () => {
    let clock = Date.now();
    const { call, store } = makeClient({ env: devEnv as never, store: mkStore(), now: () => clock });
    // 1. Submit
    const sub = await call('POST', '/api/complaints', { ...complaintBody(), photo: { mime: 'image/jpeg', dataBase64: TINY_JPEG } });
    expect(sub.status).toBe(201);
    const { complaintId, pin } = sub.json;
    expect(complaintId).toMatch(/^FB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(pin).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/);

    // Credentials recorded as keyed hash, never plaintext
    const [cred] = await store!.exec([{ op: 'get', table: 'Access_Credentials', value: complaintId }]);
    const row = cred.ok ? cred.row! : ({} as Record<string, string>);
    expect(row.pin_hash).toMatch(/^h1\$[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(pin);

    // 2. Verify
    const acc = await call('POST', '/api/access', { complaintId, pin });
    expect(acc.status).toBe(200);
    const token = acc.json.token;
    const p1 = await call('GET', '/api/portal', undefined, token);
    expect(p1.status).toBe(200);
    expect(p1.json.complaint.status).toBe('Submitted');
    expect(p1.json.complaint.hasPhoto).toBe(true);
    expect(p1.json.complaint).not.toHaveProperty('staff_notes');
    const photo = await call('GET', '/api/portal/photo', undefined, token);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('cache-control')).toContain('no-store');

    // 3. Staff registers found item and proposes match
    const st = await staffToken(call);
    const fi = await call('POST', '/api/staff/found-items', {
      category: 'Bag / Backpack', itemName: 'Black backpack', publicDescription: 'Black backpack found near library stairs',
      privateDetails: 'Green notebook inside with roll number', colorFeatures: 'Black, red zipper pulls', foundLocation: 'Central library stairs',
      foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Shelf B2', photos: [{ mime: 'image/jpeg', dataBase64: TINY_JPEG }],
    }, st);
    expect(fi.status).toBe(201);
    const itemId = fi.json.itemId;
    const detail = await call('GET', `/api/staff/complaints/${complaintId}`, undefined, st);
    expect(detail.status).toBe(200);
    expect(detail.json.suggestions[0].item.item_id).toBe(itemId);
    expect(detail.json.suggestions[0].score).toBeGreaterThan(50);
    expect((await call('POST', `/api/staff/complaints/${complaintId}/propose-match`, { itemId }, st)).status).toBe(200);

    // 4. Student sees redacted match (no private details or photos), claims it
    const p2 = await call('GET', '/api/portal', undefined, token);
    expect(p2.json.complaint.status).toBe('Potential Match');
    expect(p2.json.matches).toHaveLength(1);
    expect(JSON.stringify(p2.json.matches)).not.toContain('Green notebook inside');
    expect(JSON.stringify(p2.json.matches)).not.toContain('Shelf B2');
    const claim = await call('POST', '/api/portal/claim', { itemId, evidence: 'My green notebook with roll number 22CSE104 is inside' }, token);
    expect(claim.status).toBe(201);
    expect((await call('POST', '/api/portal/claim', { itemId, evidence: 'again again again' }, token)).status).toBe(409);

    // 5. Approval requires every verification check
    const claimId = claim.json.claimId;
    const noChecks = await call('POST', `/api/staff/claims/${claimId}/decision`, { decision: 'approve', notes: 'ok' }, st);
    expect(noChecks.status).toBe(422);
    const handoverEarly = await call('POST', '/api/staff/handovers', { claimId, receiverName: 'Asha', receiverIdChecked: true }, st);
    expect(handoverEarly.status).toBe(409);
    const ok = await call('POST', `/api/staff/claims/${claimId}/decision`, { decision: 'approve', notes: 'Notebook matches roll number', checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true } }, st);
    expect(ok.status).toBe(200);
    const p3 = await call('GET', '/api/portal', undefined, token);
    expect(p3.json.complaint.status).toBe('Ready for Collection');
    expect(p3.json.collection.instructions).toContain('college ID');

    // 6. Handover is two-party: staff issues a short-lived code, the verified
    // receiver acknowledges, then staff physically checks and releases.
    const expiredHandover = await call('POST', '/api/staff/handovers', { claimId }, st);
    expect(expiredHandover.status).toBe(201);
    expect(expiredHandover.json.code).toMatch(/^\d{6}$/);
    const receiver = (await call('POST', '/api/v2/auth/dev-session', { role: 'guest', uid: 'receiver-1', name: 'Asha Reddy' })).json.token;
    clock += 11 * 60 * 1000;
    expect((await call('POST', `/api/v2/handovers/${expiredHandover.json.handoverId}/confirm`, {
      code: expiredHandover.json.code,
      receiverName: 'Asha Reddy',
      acknowledgment: 'I confirm that I received this item at the office counter.',
      ownerAuthorization: 'Owner authorised this proxy collection in writing.',
    }, receiver)).status).toBe(410);
    const ho = await call('POST', '/api/staff/handovers', { claimId }, st);
    expect(ho.status).toBe(201);
    expect(ho.json.handoverId).not.toBe(expiredHandover.json.handoverId);
    const confirm = await call('POST', `/api/v2/handovers/${ho.json.handoverId}/confirm`, {
      code: ho.json.code,
      receiverName: 'Asha Reddy',
      acknowledgment: 'I confirm that I received this item at the office counter.',
      ownerAuthorization: 'Owner authorised this proxy collection in writing.',
    }, receiver);
    expect(confirm.status).toBe(200);
    expect((await call('POST', `/api/staff/handovers/${ho.json.handoverId}/complete`, { receiverIdChecked: false }, st)).status).toBe(422);
    expect((await call('POST', `/api/staff/handovers/${ho.json.handoverId}/complete`, { receiverIdChecked: true, notes: 'ID card checked' }, st)).status).toBe(200);
    const p4 = await call('GET', '/api/portal', undefined, token);
    expect(p4.json.complaint.status).toBe('Returned');
    expect(p4.json.timeline.map((t: { status: string }) => t.status)).toEqual(['Submitted', 'Potential Match', 'Awaiting Verification', 'Ready for Collection', 'Awaiting Receiver Confirmation', 'Returned']);
    const item = await call('GET', `/api/staff/found-items/${itemId}`, undefined, st);
    expect(item.json.item.status).toBe('Returned');

    // 7. Close; activity log + analytics reflect it
    expect((await call('POST', `/api/staff/complaints/${complaintId}/status`, { status: 'Closed', note: 'Done' }, st)).status).toBe(200);
    const logs = await call('GET', '/api/staff/activity', undefined, st);
    const actions = logs.json.rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['complaint_submitted', 'found_item_registered', 'match_proposed', 'claim_requested', 'claim_approved', 'item_handed_over', 'status_changed']));
    const an = await call('GET', '/api/staff/analytics', undefined, st);
    expect(an.json.totals.handovers).toBe(1);
  });
});

describe('Submission rules', () => {
  it('completes the V2 verified-reporter workflow without editable identity or a PIN', async () => {
    const { call } = makeClient({ env: devEnv as never });
    const reporter = (await call('POST', '/api/v2/auth/dev-session', { role: 'student', uid: 'v2-owner', name: 'Registry Name' })).json.token;
    const created = await call('POST', '/api/v2/complaints', complaintBody({ name: 'Forged Name', studentId: 'FORGED', phone: '+919999999999' }), reporter);
    expect(created.status).toBe(201);
    expect(created.json.pin).toBeUndefined();
    const complaintId = created.json.complaintId as string;

    const staff = await staffToken(call);
    const found = await call('POST', '/api/staff/found-items', {
      category: 'Bag / Backpack', itemName: 'Black backpack', publicDescription: 'Black backpack found near the library',
      privateDetails: 'Green notebook with student number', colorFeatures: 'Black with red zipper pulls',
      foundLocation: 'Central library', foundDate: new Date().toISOString().slice(0, 10), storageLocation: 'Shelf B2', photos: [],
    }, staff);
    const itemId = found.json.itemId as string;
    expect((await call('POST', `/api/staff/complaints/${complaintId}/propose-match`, { itemId }, staff)).status).toBe(200);
    const claim = await call('POST', `/api/v2/complaints/${complaintId}/claim`, { itemId, evidence: 'The green notebook inside has my student number.' }, reporter);
    expect(claim.status).toBe(201);
    expect((await call('POST', `/api/staff/claims/${claim.json.claimId}/decision`, {
      decision: 'approve', notes: 'Private details match',
      checks: { evidenceMatches: true, featuresMatch: true, noConflictingClaims: true },
    }, staff)).status).toBe(200);
    const handover = await call('POST', '/api/staff/handovers', { claimId: claim.json.claimId }, staff);
    expect((await call('POST', `/api/v2/handovers/${handover.json.handoverId}/confirm`, {
      code: handover.json.code, receiverName: 'Registry Name', acknowledgment: 'I confirm that I received my item at the counter.',
    }, reporter)).status).toBe(200);
    expect((await call('POST', `/api/staff/handovers/${handover.json.handoverId}/complete`, { receiverIdChecked: true }, staff)).status).toBe(200);
    const detail = await call('GET', `/api/v2/complaints/${complaintId}`, undefined, reporter);
    expect(detail.json.complaint.status).toBe('Returned');
    expect(detail.json.complaint.name).toBe('Registry Name');
  });

  it('validates on the backend', async () => {
    const { call } = makeClient();
    const r = await call('POST', '/api/complaints', complaintBody({ name: '', phone: '', email: '', lostDate: '2099-01-01', category: 'Spaceship' }));
    expect(r.status).toBe(422);
    expect(Object.keys(r.json.details)).toEqual(expect.arrayContaining(['name', 'category']));
  });

  it('is idempotent: a retried submission returns the same ID and a fresh PIN', async () => {
    const { call } = makeClient();
    const body = complaintBody();
    const a = await call('POST', '/api/complaints', body);
    const b = await call('POST', '/api/complaints', body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.complaintId).toBe(a.json.complaintId);
    expect(b.json.replayed).toBe(true);
    expect((await call('POST', '/api/access', { complaintId: a.json.complaintId, pin: a.json.pin })).status).toBe(401);
    expect((await call('POST', '/api/access', { complaintId: a.json.complaintId, pin: b.json.pin })).status).toBe(200);
  });

  it('rejects bots: honeypot and too-fast submissions', async () => {
    const { call } = makeClient();
    expect((await call('POST', '/api/complaints', complaintBody({ website: 'http://spam' }))).status).toBe(400);
    expect((await call('POST', '/api/complaints', complaintBody({ elapsedMs: 200 }))).status).toBe(400);
  });

  it('rejects images with wrong type or spoofed content', async () => {
    const { call } = makeClient();
    const gif = await call('POST', '/api/complaints', complaintBody({ photo: { mime: 'image/gif', dataBase64: 'R0lGOD' } }));
    expect(gif.status).toBe(422);
    const spoof = await call('POST', '/api/complaints', complaintBody({ photo: { mime: 'image/png', dataBase64: Buffer.from('<script>').toString('base64') } }));
    expect(spoof.status).toBe(415);
  });

  it('never shows success when storage is down', async () => {
    const failing = new MemoryStore();
    failing.exec = async () => { const { StoreError } = await import('../src/store/types'); throw new StoreError('unavailable'); };
    const { call } = makeClient({ store: failing });
    const r = await call('POST', '/api/complaints', complaintBody());
    expect(r.status).toBe(503);
    expect(r.json.ok).toBe(false);
    expect(r.json.complaintId).toBeUndefined();
  });

  it('reports not_configured without a store or secrets', async () => {
    const { call } = makeClient({ store: null });
    expect((await call('POST', '/api/complaints', complaintBody())).json.error).toBe('not_configured');
    const noSecrets = makeClient({ env: { PIN_PEPPER: '' } });
    expect((await noSecrets.call('POST', '/api/complaints', complaintBody())).json.error).toBe('not_configured');
  });
});
