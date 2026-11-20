import { z } from 'zod';
import {
  accessInput, claimDecisionInput, claimInput, complaintInput, DEFAULT_SETTINGS, EDITABLE_SETTINGS,
  foundItemInput, FOUND_ITEM_STATUSES, handoverInput, imageUpload, MAX_IMAGE_BYTES, portalUpdateInput,
  statusUpdateInput, STATUS_TRANSITIONS, type ComplaintStatus, type Row,
} from '../../shared/domain';
import { hashPin, safeEqual, newComplaintId, newId, newPin, sha256Hex, signSession, verifySession, type Session, type StaffSession, type StudentSession } from './crypto';
import type { Env, RateLimit } from './env';
import { parseStaffList, verifyGoogleIdToken } from './googleAuth';
import { corsHeaders, errorResponse, HttpError, json, readJson, withHeaders } from './http';
import { matchScore } from './matching';
import { LocalLimiter } from './ratelimit';
import { StoreError, type Op, type OpResult, type Store } from './store/types';

const STUDENT_TTL_MS = 15 * 60 * 1000;
const STAFF_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const DEMO_ID = '1223';

export interface AppDeps {
  env: Env;
  store: Store | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Ctx {
  req: Request;
  url: URL;
  ip: string;
  params: Record<string, string>;
}

type Handler = (c: Ctx) => Promise<Response>;

// Per-isolate fallbacks when Rate Limiting bindings are not configured.
// Campus networks put thousands of students behind a few NAT IPs, so per-IP
// limits are deliberately generous; per-complaint lockouts stop brute force.
const fallbackLimiters = {
  submit: new LocalLimiter(30, 10 * 60 * 1000),
  access: new LocalLimiter(60, 10 * 60 * 1000),
  accessPerId: new LocalLimiter(10, 10 * 60 * 1000),
  api: new LocalLimiter(600, 60 * 1000),
};

export function createApp(deps: AppDeps) {
  const { env } = deps;
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const isDev = env.APP_ENV === 'development';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const staffList = parseStaffList(env.STAFF_EMAILS);
  const staffEnabled = Boolean(env.GOOGLE_CLIENT_ID && staffList.size > 0 && env.SESSION_KEY);
  // Local-only staff login for automated tests: requires development mode AND no real (remote) data store.
  const devStaffLogin = isDev && (env as Record<string, unknown>).DEV_STAFF_LOGIN === '1' && (!env.GAS_URL || env.GAS_URL.startsWith('http://127.0.0.1'));
  const limiters = {
    submit: env.RL_SUBMIT ?? fallbackLimiters.submit,
    access: env.RL_ACCESS ?? fallbackLimiters.access,
    api: env.RL_API ?? fallbackLimiters.api,
  };
  let settingsCache: { at: number; value: Record<string, string> } | null = null;
  let dashCache: { at: number; value: unknown } | null = null;

  // ------------------------------------------------------------ helpers
  function store(): Store {
    if (!deps.store) throw new HttpError(503, 'not_configured', 'The data service is not configured yet.');
    return deps.store;
  }
  function secrets() {
    if (!env.PIN_PEPPER || !env.SESSION_KEY || env.PIN_PEPPER.length < 16 || env.SESSION_KEY.length < 16) {
      throw new HttpError(503, 'not_configured', 'Server secrets are not configured.');
    }
    return { pepper: env.PIN_PEPPER, sessionKey: env.SESSION_KEY };
  }
  async function exec(ops: Op[]): Promise<OpResult[]> {
    return store().exec(ops);
  }
  function rowOf(r: OpResult | undefined): Row | null {
    return r && r.ok ? (r.row ?? null) : null;
  }
  function rowsOf(r: OpResult | undefined): Row[] {
    return r && r.ok ? (r.rows ?? []) : [];
  }
  async function limit(l: RateLimit, key: string) {
    const { success } = await l.limit({ key });
    if (!success) throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a few minutes and try again.');
  }
  function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
    const r = schema.safeParse(data);
    if (!r.success) {
      const details: Record<string, string> = {};
      for (const issue of r.error.issues) details[issue.path.join('.') || '_'] ??= issue.message;
      throw new HttpError(422, 'validation_failed', 'Please check the highlighted fields.', details);
    }
    return r.data;
  }
  function bearer(req: Request) {
    const h = req.headers.get('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  }
  async function session(req: Request): Promise<Session | null> {
    return verifySession(secrets().sessionKey, bearer(req));
  }
  async function requireStudent(req: Request): Promise<StudentSession> {
    const s = await session(req);
    if (!s || s.t !== 'student') throw new HttpError(401, 'unauthorized', 'Your session has expired. Please verify your Complaint ID and PIN again.');
    return s;
  }
  async function requireStaff(req: Request, role?: 'admin'): Promise<StaffSession> {
    if (!staffEnabled && !devStaffLogin) throw new HttpError(503, 'staff_disabled', 'Staff access is disabled until it is configured.');
    const s = await session(req);
    if (!s || s.t !== 'staff') throw new HttpError(401, 'unauthorized', 'Staff sign-in required.');
    // Re-check the allowlist on every request so removing an email revokes access immediately.
    const current = devStaffLogin ? s.role : staffList.get(s.email);
    if (!current) throw new HttpError(403, 'forbidden', 'This account is not authorised for staff access.');
    if (role === 'admin' && current !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required.');
    return { ...s, role: current };
  }
  function log(actor: string, action: string, entity: string, entityId: string, details = ''): Op {
    return { op: 'append', table: 'Activity_Log', row: { log_id: newId('LG'), created_at: iso(), actor, action, entity, entity_id: entityId, details: details.slice(0, 500) } };
  }
  function update(cid: string, type: string, message: string, actor: string, opts: { itemId?: string; data?: unknown; visible?: boolean } = {}): Op {
    return {
      op: 'append',
      table: 'Complaint_Updates',
      row: {
        update_id: newId('UP'), created_at: iso(), complaint_id: cid, type, message, item_id: opts.itemId ?? '',
        data_json: opts.data ? JSON.stringify(opts.data) : '', visible_to_student: opts.visible === false ? 'false' : 'true', actor,
      },
    };
  }
  async function getSettings(): Promise<Record<string, string>> {
    if (settingsCache && now() - settingsCache.at < 60_000) return settingsCache.value;
    const rows = rowsOf((await exec([{ op: 'query', table: 'Application_Settings', limit: 200 }]))[0]);
    const value = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (EDITABLE_SETTINGS.includes(r.key)) value[r.key] = r.value;
    settingsCache = { at: now(), value };
    return value;
  }
  function retentionUntil(settings: Record<string, string>) {
    const days = Math.max(30, parseInt(settings.retention_days || '180', 10) || 180);
    return new Date(now() + days * 86400e3).toISOString();
  }
  function checkImage(img: z.output<typeof imageUpload>) {
    const bin = atob(img.dataBase64);
    if (bin.length === 0 || bin.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large', 'Images must be under 3 MB.');
    const b = (i: number) => bin.charCodeAt(i);
    const sig =
      (img.mime === 'image/jpeg' && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ||
      (img.mime === 'image/png' && b(0) === 0x89 && bin.slice(1, 4) === 'PNG') ||
      (img.mime === 'image/webp' && bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP');
    if (!sig) throw new HttpError(415, 'bad_image', 'Only JPEG, PNG or WebP images are accepted.');
  }
  function transition(from: string, to: ComplaintStatus) {
    const allowed = STATUS_TRANSITIONS[from as ComplaintStatus] ?? [];
    if (!allowed.includes(to)) throw new HttpError(409, 'invalid_transition', `Cannot move a complaint from "${from}" to "${to}".`);
  }
  function mustOk(results: OpResult[], expected: number, what = 'record') {
    const failed = results.find((r) => !r.ok) as { ok: false; error: string } | undefined;
    if (failed) {
      if (failed.error === 'conflict') throw new HttpError(409, 'conflict', `This ${what} was changed by someone else. Refresh and try again.`);
      if (failed.error === 'not_found') throw new HttpError(404, 'not_found', `${what} not found.`);
      throw new HttpError(409, failed.error, `Could not save the ${what}.`);
    }
    if (results.length < expected) throw new HttpError(502, 'incomplete', 'The data service did not confirm every change.');
  }
  function studentComplaint(c: Row) {
    return {
      complaintId: c.complaint_id, createdAt: c.created_at, updatedAt: c.updated_at, status: c.status,
      name: c.name, studentId: c.student_id, department: c.department, phone: c.phone, email: c.email,
      category: c.category, itemName: c.item_name, description: c.description, colorFeatures: c.color_features,
      lastSeenLocation: c.last_seen_location, lostDate: c.lost_date, lostTime: c.lost_time, hasPhoto: Boolean(c.photo_file_id),
      ownershipEvidence: c.ownership_evidence, extraInfo: c.extra_info, collectionInstructions: c.collection_instructions,
    };
  }
  function activeMatches(updates: Row[]) {
    const m = new Map<string, Row>();
    for (const u of [...updates].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (u.type === 'match_proposed') m.set(u.item_id, u);
      if (u.type === 'match_withdrawn') m.delete(u.item_id);
    }
    return m;
  }
  function safeJson(s: string): Record<string, unknown> {
    try { return s ? JSON.parse(s) : {}; } catch { return {}; }
  }
  async function loadStudent(s: StudentSession) {
    const r = await exec([
      { op: 'get', table: 'Complaints', value: s.cid },
      { op: 'get', table: 'Access_Credentials', value: s.cid },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: s.cid }, limit: 200, order: 'asc' },
      { op: 'query', table: 'Claim_Requests', where: { complaint_id: s.cid }, limit: 50 },
    ]);
    const c = rowOf(r[0]);
    const cred = rowOf(r[1]);
    // Sessions are bound to the credential version, so a staff PIN reset revokes them.
    if (!c || !cred || (cred.rotated_at || cred.created_at) !== s.v) {
      throw new HttpError(401, 'unauthorized', 'Your session is no longer valid. Please verify again.');
    }
    return { c, updates: rowsOf(r[2]), claims: rowsOf(r[3]) };
  }
  async function fileResponse(fileId: string) {
    const f = fileId ? await store().getFile(fileId) : null;
    if (!f) throw new HttpError(404, 'not_found', 'Image not found.');
    const bin = atob(f.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': f.mime, 'cache-control': 'private, no-store', 'content-disposition': 'inline' } });
  }

  // ------------------------------------------------------------ public routes
  const publicConfig: Handler = async () => {
    let settings = DEFAULT_SETTINGS;
    let degraded = false;
    try {
      settings = await getSettings();
    } catch {
      degraded = true;
    }
    return json({
      ok: true,
      degraded,
      collectionOffice: settings.collection_office,
      collectionHours: settings.collection_hours,
      contactEmail: settings.contact_email,
      contactPhone: settings.contact_phone,
      submissionsOpen: settings.submissions_open !== 'false',
      staff: { enabled: staffEnabled, googleClientId: staffEnabled ? env.GOOGLE_CLIENT_ID : null, devLogin: devStaffLogin },
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      environment: isDev ? 'development' : 'production',
    });
  };

  const health: Handler = async () => {
    const configured = Boolean(deps.store && env.PIN_PEPPER && env.SESSION_KEY);
    const reachable = deps.store ? await deps.store.ping() : false;
    return json({ ok: configured && reachable, configured, storeReachable: reachable, staffEnabled, time: iso() }, configured && reachable ? 200 : 503);
  };

  const createComplaint: Handler = async ({ req, ip }) => {
    await limit(limiters.submit, `submit:${ip}`);
    const { pepper } = secrets();
    const body = await readJson<Record<string, unknown>>(req, 4_500_000);
    if (typeof body.website === 'string' && body.website.length > 0) throw new HttpError(400, 'rejected', 'Submission rejected.');
    if (typeof body.elapsedMs !== 'number' || body.elapsedMs < 3000) throw new HttpError(400, 'too_fast', 'Please take a moment to review your details before submitting.');
    const idem = String(body.idempotencyKey ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(idem)) throw new HttpError(400, 'bad_request', 'Missing idempotency key.');
    if (env.TURNSTILE_SECRET) {
      const form = new FormData();
      form.append('secret', env.TURNSTILE_SECRET);
      form.append('response', String(body.turnstileToken ?? ''));
      form.append('remoteip', ip);
      const tv = await (deps.fetchImpl ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      const tj = (await tv.json()) as { success?: boolean };
      if (!tj.success) throw new HttpError(400, 'bot_check_failed', 'Bot check failed. Please retry the verification.');
    }
    const input = parse(complaintInput, body);
    const settings = await getSettings();
    if (settings.submissions_open === 'false') throw new HttpError(503, 'submissions_closed', 'New complaints are temporarily paused by the office.');

    let photoFileId = '';
    if (body.photo) {
      const img = parse(imageUpload, body.photo);
      checkImage(img);
      photoFileId = await store().uploadFile(`complaint-${idem.slice(0, 8)}.${img.mime.split('/')[1]}`, img.mime, img.dataBase64);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const cid = newComplaintId();
      const pin = newPin();
      const t = iso();
      const results = await exec([
        {
          op: 'append', table: 'Complaints', unique: 'idempotency_key',
          row: {
            complaint_id: cid, created_at: t, updated_at: t, status: 'Submitted', idempotency_key: idem,
            name: input.name, student_id: input.studentId, department: input.department, phone: input.phone, email: input.email,
            category: input.category, item_name: input.itemName, description: input.description, color_features: input.colorFeatures,
            last_seen_location: input.lastSeenLocation, lost_date: input.lostDate, lost_time: input.lostTime,
            photo_file_id: photoFileId, ownership_evidence: input.ownershipEvidence, extra_info: '', linked_item_id: '',
            collection_instructions: '', staff_notes: '', retention_until: '', version: '1',
          },
        },
        { op: 'append', table: 'Access_Credentials', row: { complaint_id: cid, pin_hash: await hashPin(pepper, cid, pin), created_at: t, failed_attempts: '0', locked_until: '', last_success_at: '', rotated_at: '', version: '1' } },
        update(cid, 'status', 'Complaint submitted', 'student', { data: { status: 'Submitted' } }),
        log('student', 'complaint_submitted', 'Complaint', cid, `ip:${(await sha256Hex(ip)).slice(0, 12)}`),
      ]);
      const first = results[0];
      if (first && !first.ok && first.error === 'duplicate_key') continue; // ID collision: regenerate
      if (first && !first.ok && first.error === 'duplicate' && first.row) {
        // Idempotent replay (e.g. the first response was lost). The client never saw
        // the original PIN, so rotate it and return the same Complaint ID.
        const existing = first.row;
        if (now() - Date.parse(existing.created_at) > 24 * 3600e3) throw new HttpError(409, 'duplicate', 'This submission was already recorded.');
        const replayPin = newPin();
        const rt = iso();
        const rr = await exec([
          { op: 'update', table: 'Access_Credentials', value: existing.complaint_id, patch: { pin_hash: await hashPin(pepper, existing.complaint_id, replayPin), rotated_at: rt, failed_attempts: '0', locked_until: '' } },
          log('student', 'complaint_replayed', 'Complaint', existing.complaint_id),
        ]);
        mustOk(rr, 2, 'complaint');
        return json({ ok: true, complaintId: existing.complaint_id, pin: replayPin, createdAt: existing.created_at, replayed: true }, 200);
      }
      mustOk(results, 4, 'complaint');
      return json({ ok: true, complaintId: cid, pin, createdAt: t }, 201);
    }
    throw new HttpError(503, 'id_generation_failed', 'Could not allocate a Complaint ID. Please retry.');
  };

  const access: Handler = async ({ req, ip }) => {
    await limit(limiters.access, `access:${ip}`);
    const { pepper, sessionKey } = secrets();
    const body = await readJson(req);
    const raw = (body ?? {}) as { complaintId?: unknown; pin?: unknown };
    const invalid = new HttpError(401, 'invalid_credentials', 'The Complaint ID or PIN is incorrect.');
    let input: { complaintId: string; pin: string };
    if (isDev && String(raw.complaintId ?? '').trim() === DEMO_ID) {
      input = { complaintId: DEMO_ID, pin: String(raw.pin ?? '').trim().toUpperCase() };
    } else {
      input = parse(accessInput, body);
    }
    await limit(fallbackLimiters.accessPerId, `id:${input.complaintId}`);
    const r = await exec([{ op: 'get', table: 'Access_Credentials', value: input.complaintId }]);
    const cred = rowOf(r[0]);
    const candidate = await hashPin(pepper, input.complaintId, input.pin); // computed even when absent (timing)
    if (!cred) throw invalid;
    if (cred.locked_until && Date.parse(cred.locked_until) > now()) {
      const mins = Math.ceil((Date.parse(cred.locked_until) - now()) / 60000);
      throw new HttpError(429, 'locked', `Too many incorrect attempts. Try again in ${mins} minute(s) or visit the office for staff-assisted recovery.`);
    }
    const matches = safeEqual(candidate, cred.pin_hash);
    if (!matches) {
      const failed = (parseInt(cred.failed_attempts || '0', 10) || 0) + 1;
      const patch: Row = { failed_attempts: String(failed) };
      if (failed % MAX_FAILED === 0) {
        const lockMin = Math.min(15 * 2 ** (failed / MAX_FAILED - 1), 24 * 60);
        patch.locked_until = new Date(now() + lockMin * 60000).toISOString();
      }
      await exec([
        { op: 'update', table: 'Access_Credentials', value: input.complaintId, patch },
        log('anonymous', 'access_failed', 'Complaint', input.complaintId, `attempt ${failed}`),
      ]);
      throw invalid;
    }
    // Avoid a serialized sheet write on every login: only reset counters when they are dirty.
    if (cred.failed_attempts !== '0' || cred.locked_until) {
      await exec([{ op: 'update', table: 'Access_Credentials', value: input.complaintId, patch: { failed_attempts: '0', locked_until: '', last_success_at: iso() } }]);
    }
    const exp = now() + STUDENT_TTL_MS;
    const token = await signSession(sessionKey, { t: 'student', cid: input.complaintId, v: cred.rotated_at || cred.created_at, exp });
    return json({ ok: true, token, expiresAt: exp });
  };

  // ------------------------------------------------------------ student portal
  const portal: Handler = async ({ req }) => {
    const s = await requireStudent(req);
    const { c, updates, claims } = await loadStudent(s);
    const settings = await getSettings();
    const matches = [...activeMatches(updates).values()].map((u) => {
      const claim = claims.find((cl) => cl.item_id === u.item_id && cl.status !== 'Withdrawn');
      return { itemId: u.item_id, proposedAt: u.created_at, note: u.message, item: safeJson(u.data_json), claimStatus: claim?.status ?? null };
    });
    const timeline = updates.filter((u) => u.type === 'status').map((u) => ({ status: String(safeJson(u.data_json).status ?? ''), at: u.created_at, message: u.message }));
    const notifications = updates.filter((u) => u.visible_to_student === 'true').reverse().slice(0, 50).map((u) => ({ id: u.update_id, type: u.type, message: u.message, at: u.created_at }));
    return json({
      ok: true,
      complaint: studentComplaint(c),
      timeline,
      notifications,
      matches,
      claims: claims.map((cl) => ({ claimId: cl.claim_id, itemId: cl.item_id, status: cl.status, createdAt: cl.created_at, decisionNotes: cl.status === 'Rejected' || cl.status === 'Approved' ? cl.decision_notes : '' })),
      collection: { office: settings.collection_office, hours: settings.collection_hours, instructions: c.collection_instructions, contactEmail: settings.contact_email, contactPhone: settings.contact_phone },
      sessionExpiresAt: s.exp,
    });
  };

  const portalUpdate: Handler = async ({ req }) => {
    const s = await requireStudent(req);
    const input = parse(portalUpdateInput, await readJson(req));
    const { c } = await loadStudent(s);
    if (c.status === 'Closed' || c.status === 'Returned') throw new HttpError(409, 'closed', 'This complaint is closed and can no longer be updated.');
    const phone = input.phone || c.phone;
    const email = input.email || c.email;
    if (!phone && !email) throw new HttpError(422, 'validation_failed', 'Keep at least one contact method.', { phone: 'Give a phone number or email' });
    const patch: Row = { phone, email, updated_at: iso() };
    const changes: string[] = [];
    if (input.phone && input.phone !== c.phone) changes.push('phone');
    if (input.email && input.email !== c.email) changes.push('email');
    if (input.extraInfo) {
      patch.extra_info = (c.extra_info ? c.extra_info + '\n' : '') + `[${iso().slice(0, 10)}] ${input.extraInfo}`.slice(0, 1000);
      if (patch.extra_info.length > 3000) throw new HttpError(422, 'validation_failed', 'Additional information limit reached. Please contact the office.');
      changes.push('additional information');
    }
    if (!changes.length) throw new HttpError(422, 'validation_failed', 'Nothing to update.');
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch, expectVersion: c.version },
      update(c.complaint_id, 'student_update', `You updated: ${changes.join(', ')}`, 'student'),
      log('student', 'complaint_updated', 'Complaint', c.complaint_id, changes.join(',')),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true });
  };

  const portalClaim: Handler = async ({ req }) => {
    const s = await requireStudent(req);
    const input = parse(claimInput, await readJson(req));
    const { c, updates, claims } = await loadStudent(s);
    if (!activeMatches(updates).has(input.itemId)) throw new HttpError(404, 'not_found', 'This item is not a proposed match for your complaint.');
    if (claims.some((cl) => cl.item_id === input.itemId && ['Pending', 'Approved', 'Completed'].includes(cl.status))) {
      throw new HttpError(409, 'already_claimed', 'You have already requested this item.');
    }
    transition(c.status, 'Awaiting Verification');
    const claimId = newId('CL');
    const t = iso();
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Awaiting Verification', updated_at: t }, expectVersion: c.version },
      { op: 'append', table: 'Claim_Requests', row: { claim_id: claimId, created_at: t, complaint_id: c.complaint_id, item_id: input.itemId, evidence: input.evidence, status: 'Pending', reviewed_by: '', reviewed_at: '', decision_notes: '', checks_json: '', version: '1' } },
      update(c.complaint_id, 'status', 'Ownership claim submitted. Staff will verify your evidence.', 'student', { itemId: input.itemId, data: { status: 'Awaiting Verification' } }),
      log('student', 'claim_requested', 'Claim', claimId, `item ${input.itemId}`),
    ]);
    mustOk(r, 4, 'claim');
    return json({ ok: true, claimId }, 201);
  };

  const portalClose: Handler = async ({ req }) => {
    const s = await requireStudent(req);
    const body = (await readJson<{ reason?: string }>(req)) ?? {};
    const reason = String(body.reason ?? '').slice(0, 300).trim();
    const { c } = await loadStudent(s);
    transition(c.status, 'Closed');
    const settings = await getSettings();
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Closed', updated_at: iso(), retention_until: retentionUntil(settings) }, expectVersion: c.version },
      update(c.complaint_id, 'status', reason ? `Closed by you: ${reason}` : 'Closed by you', 'student', { data: { status: 'Closed' } }),
      log('student', 'complaint_closed_by_student', 'Complaint', c.complaint_id),
    ]);
    mustOk(r, 3, 'complaint');
    return json({ ok: true });
  };

  const portalPhoto: Handler = async ({ req }) => {
    const s = await requireStudent(req);
    const { c } = await loadStudent(s);
    return fileResponse(c.photo_file_id);
  };

  // ------------------------------------------------------------ staff
  const staffSession: Handler = async ({ req, ip }) => {
    await limit(limiters.access, `staff:${ip}`);
    if (!staffEnabled) throw new HttpError(503, 'staff_disabled', 'Staff access is disabled until it is configured.');
    const { sessionKey } = secrets();
    const body = await readJson<{ credential?: string }>(req);
    const claims = await verifyGoogleIdToken(String(body?.credential ?? ''), env.GOOGLE_CLIENT_ID!, deps.fetchImpl);
    if (env.STAFF_DOMAIN && claims.hd !== env.STAFF_DOMAIN) throw new HttpError(403, 'forbidden', 'Use your institutional Google account.');
    const role = staffList.get(claims.email);
    if (!role) {
      await exec([log(claims.email, 'staff_login_denied', 'Staff', claims.email)]).catch(() => undefined);
      throw new HttpError(403, 'forbidden', 'This account is not authorised for staff access.');
    }
    const exp = now() + STAFF_TTL_MS;
    const token = await signSession(sessionKey, { t: 'staff', email: claims.email, role, exp });
    await exec([log(claims.email, 'staff_login', 'Staff', claims.email)]);
    return json({ ok: true, token, email: claims.email, role, name: claims.name ?? '', expiresAt: exp });
  };

  const devStaffSession: Handler = async ({ req }) => {
    if (!devStaffLogin) throw new HttpError(404, 'not_found', 'Not found');
    const body = await readJson<{ email?: string; role?: string }>(req);
    const email = String(body?.email ?? 'dev.staff@example.edu').toLowerCase();
    const role = body?.role === 'staff' ? 'staff' : 'admin';
    const exp = now() + STAFF_TTL_MS;
    return json({ ok: true, token: await signSession(secrets().sessionKey, { t: 'staff', email, role, exp }), email, role, name: 'Development Staff', expiresAt: exp });
  };

  const staffMe: Handler = async ({ req }) => {
    const s = await requireStaff(req);
    return json({ ok: true, email: s.email, role: s.role, expiresAt: s.exp });
  };

  const dashboard: Handler = async ({ req }) => {
    await requireStaff(req);
    if (dashCache && now() - dashCache.at < 20_000) return json(dashCache.value);
    const r = await exec([
      { op: 'query', table: 'Complaints', columns: ['complaint_id', 'created_at', 'status', 'category', 'item_name'], limit: 5000 },
      { op: 'query', table: 'Found_Items', columns: ['item_id', 'created_at', 'status', 'category', 'item_name', 'found_date'], limit: 5000 },
      { op: 'query', table: 'Claim_Requests', where: { status: 'Pending' }, limit: 100 },
      { op: 'query', table: 'Activity_Log', limit: 8 },
    ]);
    const complaints = rowsOf(r[0]);
    const items = rowsOf(r[1]);
    const byStatus: Record<string, number> = {};
    for (const c of complaints) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const itemsByStatus: Record<string, number> = {};
    for (const i of items) itemsByStatus[i.status] = (itemsByStatus[i.status] ?? 0) + 1;
    const value = {
      ok: true,
      totals: { complaints: (r[0] as { total?: number }).total ?? complaints.length, foundItems: (r[1] as { total?: number }).total ?? items.length, pendingClaims: rowsOf(r[2]).length },
      byStatus,
      itemsByStatus,
      recentComplaints: complaints.slice(0, 6),
      recentItems: items.slice(0, 6),
      pendingClaims: rowsOf(r[2]).slice(0, 6).map((c) => ({ claimId: c.claim_id, complaintId: c.complaint_id, itemId: c.item_id, createdAt: c.created_at })),
      recentActivity: rowsOf(r[3]),
    };
    dashCache = { at: now(), value };
    return json(value);
  };

  const listComplaints: Handler = async ({ req, url }) => {
    await requireStaff(req);
    const status = url.searchParams.get('status') ?? '';
    const q = (url.searchParams.get('q') ?? '').trim().toUpperCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const columns = ['complaint_id', 'created_at', 'updated_at', 'status', 'category', 'item_name', 'student_id', 'last_seen_location', 'lost_date'];
    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (q) where[/^FB-/.test(q) ? 'complaint_id' : 'student_id'] = q;
    const r = await exec([{ op: 'query', table: 'Complaints', where, columns, offset: (page - 1) * 25, limit: 25 }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: (r[0] as { total?: number }).total ?? 0, page, pageSize: 25 });
  };

  const getComplaint: Handler = async ({ req, params }) => {
    await requireStaff(req);
    const r = await exec([
      { op: 'get', table: 'Complaints', value: params.id },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: params.id }, limit: 200, order: 'asc' },
      { op: 'query', table: 'Claim_Requests', where: { complaint_id: params.id }, limit: 50 },
      { op: 'query', table: 'Found_Items', where: { status: 'In Storage' }, limit: 2000 },
      { op: 'get', table: 'Access_Credentials', value: params.id },
      { op: 'query', table: 'Handover_Records', where: { complaint_id: params.id }, limit: 10 },
    ]);
    const c = rowOf(r[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const updates = rowsOf(r[1]);
    const active = activeMatches(updates);
    const suggestions = rowsOf(r[3])
      .filter((f) => !active.has(f.item_id))
      .map((f) => ({ item: f, score: matchScore(c, f) }))
      .filter((s) => s.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const cred = rowOf(r[4]);
    const { idempotency_key: _i, ...complaint } = c;
    return json({
      ok: true,
      complaint,
      updates,
      claims: rowsOf(r[2]),
      handovers: rowsOf(r[5]),
      activeMatches: [...active.values()].map((u) => ({ itemId: u.item_id, at: u.created_at, item: safeJson(u.data_json), note: u.message })),
      suggestions,
      access: cred ? { failedAttempts: cred.failed_attempts, lockedUntil: cred.locked_until, lastSuccessAt: cred.last_success_at, rotatedAt: cred.rotated_at } : null,
      allowedTransitions: STATUS_TRANSITIONS[c.status as ComplaintStatus] ?? [],
    });
  };

  const setStatus: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const input = parse(statusUpdateInput, await readJson(req));
    if (['Awaiting Verification', 'Ready for Collection', 'Returned'].includes(input.status)) {
      throw new HttpError(409, 'use_workflow', 'This status is set by the claim verification and handover workflow.');
    }
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    transition(c.status, input.status);
    const settings = await getSettings();
    const patch: Row = { status: input.status, updated_at: iso() };
    if (input.status === 'Closed') patch.retention_until = retentionUntil(settings);
    if (input.note) patch.staff_notes = (c.staff_notes ? c.staff_notes + '\n' : '') + `[${iso().slice(0, 16)} ${s.email}] ${input.note}`;
    const r = await exec([
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch, expectVersion: c.version },
      update(c.complaint_id, 'status', input.note && input.status === 'Closed' ? `Complaint closed: ${input.note}` : `Status changed to ${input.status}`, s.email, { data: { status: input.status } }),
      log(s.email, 'status_changed', 'Complaint', c.complaint_id, `${c.status} -> ${input.status}`),
    ]);
    mustOk(r, 3, 'complaint');
    dashCache = null;
    return json({ ok: true });
  };

  const addNote: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const body = await readJson<{ note?: string; visibleToStudent?: boolean }>(req);
    const note = String(body?.note ?? '').trim().slice(0, 500);
    if (note.length < 2) throw new HttpError(422, 'validation_failed', 'Write a note.', { note: 'Required' });
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const r = await exec([
      update(c.complaint_id, 'note', note, s.email, { visible: body?.visibleToStudent === true }),
      log(s.email, 'note_added', 'Complaint', c.complaint_id),
    ]);
    mustOk(r, 2, 'note');
    return json({ ok: true });
  };

  const proposeMatch: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const body = await readJson<{ itemId?: string; note?: string }>(req);
    const itemId = String(body?.itemId ?? '');
    const r0 = await exec([
      { op: 'get', table: 'Complaints', value: params.id },
      { op: 'get', table: 'Found_Items', value: itemId },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: params.id }, limit: 200 },
    ]);
    const c = rowOf(r0[0]);
    const f = rowOf(r0[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Complaint or item not found.');
    if (!['In Storage', 'Matched'].includes(f.status)) throw new HttpError(409, 'item_unavailable', `Item is ${f.status}.`);
    if (['Returned', 'Closed', 'Ready for Collection'].includes(c.status)) throw new HttpError(409, 'invalid_transition', `Complaint is ${c.status}.`);
    if (activeMatches(rowsOf(r0[2])).has(itemId)) throw new HttpError(409, 'already_proposed', 'Already proposed.');
    const t = iso();
    const ops: Op[] = [];
    if (c.status === 'Submitted' || c.status === 'Under Review') {
      ops.push({ op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Potential Match', updated_at: t }, expectVersion: c.version });
      ops.push(update(c.complaint_id, 'status', 'A possible match was found', s.email, { data: { status: 'Potential Match' } }));
    }
    // Students only see this redacted snapshot — never private details or photos.
    const publicItem = { category: f.category, itemName: f.item_name, description: f.public_description, colorFeatures: f.color_features, foundLocation: f.found_location, foundDate: f.found_date };
    ops.push(update(c.complaint_id, 'match_proposed', String(body?.note ?? '').slice(0, 300) || 'Staff found an item that may be yours. Review it and request a claim if it is yours.', s.email, { itemId, data: publicItem }));
    ops.push({ op: 'update', table: 'Found_Items', value: itemId, patch: { status: 'Matched', matched_complaint_id: f.matched_complaint_id || c.complaint_id, updated_at: t } });
    ops.push(log(s.email, 'match_proposed', 'Complaint', c.complaint_id, `item ${itemId}`));
    mustOk(await exec(ops), ops.length, 'match');
    dashCache = null;
    return json({ ok: true });
  };

  const withdrawMatch: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const body = await readJson<{ itemId?: string }>(req);
    const itemId = String(body?.itemId ?? '');
    const r0 = await exec([
      { op: 'get', table: 'Found_Items', value: itemId },
      { op: 'query', table: 'Complaint_Updates', where: { complaint_id: params.id }, limit: 200 },
    ]);
    const f = rowOf(r0[0]);
    if (!f || !activeMatches(rowsOf(r0[1])).has(itemId)) throw new HttpError(404, 'not_found', 'Match not found.');
    const ops: Op[] = [update(params.id, 'match_withdrawn', 'A proposed match was withdrawn after review.', s.email, { itemId })];
    if (f.status === 'Matched' && f.matched_complaint_id === params.id) {
      ops.push({ op: 'update', table: 'Found_Items', value: itemId, patch: { status: 'In Storage', matched_complaint_id: '', updated_at: iso() } });
    }
    ops.push(log(s.email, 'match_withdrawn', 'Complaint', params.id, `item ${itemId}`));
    mustOk(await exec(ops), ops.length, 'match');
    return json({ ok: true });
  };

  const resetPin: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const { pepper } = secrets();
    const body = await readJson<{ verification?: string }>(req);
    const verification = String(body?.verification ?? '').trim();
    if (verification.length < 10) throw new HttpError(422, 'validation_failed', 'Describe how ownership and identity were verified in person.', { verification: 'At least 10 characters' });
    const c = rowOf((await exec([{ op: 'get', table: 'Complaints', value: params.id }]))[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Complaint not found.');
    const pin = newPin();
    const t = iso();
    const r = await exec([
      { op: 'update', table: 'Access_Credentials', value: c.complaint_id, patch: { pin_hash: await hashPin(pepper, c.complaint_id, pin), rotated_at: t, failed_attempts: '0', locked_until: '' } },
      update(c.complaint_id, 'pin_reset', 'Your PIN was reset at the office after identity verification. Previous sessions were signed out.', s.email),
      log(s.email, 'pin_reset', 'Complaint', c.complaint_id, verification),
    ]);
    mustOk(r, 3, 'credential');
    return json({ ok: true, complaintId: c.complaint_id, pin });
  };

  const listFound: Handler = async ({ req, url }) => {
    await requireStaff(req);
    const status = url.searchParams.get('status') ?? '';
    const category = url.searchParams.get('category') ?? '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (category) where.category = category;
    const r = await exec([{ op: 'query', table: 'Found_Items', where, offset: (page - 1) * 24, limit: 24 }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: (r[0] as { total?: number }).total ?? 0, page, pageSize: 24 });
  };

  const createFound: Handler = async ({ req }) => {
    const s = await requireStaff(req);
    const body = await readJson<Record<string, unknown>>(req, 13_000_000);
    const input = parse(foundItemInput, body);
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 3).map((p) => parse(imageUpload, p)) : [];
    photos.forEach(checkImage);
    const itemId = newId('FI');
    const ids: string[] = [];
    for (const [i, p] of photos.entries()) ids.push(await store().uploadFile(`${itemId}-${i + 1}.${p.mime.split('/')[1]}`, p.mime, p.dataBase64));
    const t = iso();
    const r = await exec([
      {
        op: 'append', table: 'Found_Items',
        row: {
          item_id: itemId, created_at: t, updated_at: t, status: 'In Storage', category: input.category, item_name: input.itemName,
          public_description: input.publicDescription, private_details: input.privateDetails, color_features: input.colorFeatures,
          found_location: input.foundLocation, found_date: input.foundDate, storage_location: input.storageLocation,
          photo_file_ids: ids.join(','), registered_by: s.email, matched_complaint_id: '', version: '1',
        },
      },
      log(s.email, 'found_item_registered', 'FoundItem', itemId, input.itemName),
    ]);
    mustOk(r, 2, 'found item');
    dashCache = null;
    return json({ ok: true, itemId }, 201);
  };

  const getFound: Handler = async ({ req, params }) => {
    await requireStaff(req);
    const r = await exec([
      { op: 'get', table: 'Found_Items', value: params.id },
      { op: 'query', table: 'Claim_Requests', where: { item_id: params.id }, limit: 50 },
      { op: 'query', table: 'Complaints', where: { status: 'Submitted' }, limit: 1000 },
      { op: 'query', table: 'Complaints', where: { status: 'Under Review' }, limit: 1000 },
      { op: 'query', table: 'Complaints', where: { status: 'Potential Match' }, limit: 1000 },
    ]);
    const f = rowOf(r[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    const candidates = [...rowsOf(r[2]), ...rowsOf(r[3]), ...rowsOf(r[4])]
      .map((c) => ({ complaint: { complaint_id: c.complaint_id, item_name: c.item_name, category: c.category, color_features: c.color_features, last_seen_location: c.last_seen_location, lost_date: c.lost_date, status: c.status, created_at: c.created_at }, score: matchScore(c, f) }))
      .filter((x) => x.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return json({ ok: true, item: f, claims: rowsOf(r[1]), suggestions: candidates });
  };

  const setFoundStatus: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const body = await readJson<{ status?: string; note?: string; storageLocation?: string }>(req);
    const status = String(body?.status ?? '');
    if (!['In Storage', 'Donated', 'Disposed'].includes(status) || !FOUND_ITEM_STATUSES.includes(status as never)) {
      throw new HttpError(422, 'validation_failed', 'Choose In Storage, Donated or Disposed.');
    }
    const note = String(body?.note ?? '').trim().slice(0, 300);
    const f = rowOf((await exec([{ op: 'get', table: 'Found_Items', value: params.id }]))[0]);
    if (!f) throw new HttpError(404, 'not_found', 'Item not found.');
    if (['Claimed', 'Returned'].includes(f.status)) throw new HttpError(409, 'invalid_transition', `Item is ${f.status}.`);
    if ((status === 'Donated' || status === 'Disposed') && note.length < 3) throw new HttpError(422, 'validation_failed', 'Record a disposal note.', { note: 'Required' });
    const patch: Row = { status, updated_at: iso() };
    if (status !== 'In Storage') patch.matched_complaint_id = f.matched_complaint_id;
    if (body?.storageLocation) patch.storage_location = String(body.storageLocation).slice(0, 120);
    const r = await exec([
      { op: 'update', table: 'Found_Items', value: f.item_id, patch, expectVersion: f.version },
      log(s.email, 'found_item_status', 'FoundItem', f.item_id, `${f.status} -> ${status}${note ? ': ' + note : ''}`),
    ]);
    mustOk(r, 2, 'found item');
    dashCache = null;
    return json({ ok: true });
  };

  const listClaims: Handler = async ({ req, url }) => {
    await requireStaff(req);
    const status = url.searchParams.get('status') ?? 'Pending';
    const r = await exec([{ op: 'query', table: 'Claim_Requests', where: status ? { status } : {}, limit: 100 }]);
    const claims = rowsOf(r[0]);
    if (!claims.length) return json({ ok: true, rows: [] });
    const ops: Op[] = [];
    for (const cl of claims.slice(0, 12)) {
      ops.push({ op: 'get', table: 'Complaints', value: cl.complaint_id });
      ops.push({ op: 'get', table: 'Found_Items', value: cl.item_id });
    }
    const rr = await exec(ops);
    const rows = claims.map((cl, i) => {
      if (i >= 12) return { claim: cl, complaint: null, item: null };
      const c = rowOf(rr[i * 2]);
      const f = rowOf(rr[i * 2 + 1]);
      return {
        claim: cl,
        complaint: c && { complaint_id: c.complaint_id, name: c.name, student_id: c.student_id, department: c.department, item_name: c.item_name, description: c.description, color_features: c.color_features, ownership_evidence: c.ownership_evidence, status: c.status, version: c.version },
        item: f && { item_id: f.item_id, item_name: f.item_name, public_description: f.public_description, private_details: f.private_details, color_features: f.color_features, status: f.status, storage_location: f.storage_location, photo_file_ids: f.photo_file_ids },
      };
    });
    return json({ ok: true, rows, total: claims.length });
  };

  const decideClaim: Handler = async ({ req, params }) => {
    const s = await requireStaff(req);
    const input = parse(claimDecisionInput, await readJson(req));
    const r0 = await exec([{ op: 'get', table: 'Claim_Requests', value: params.id }]);
    const cl = rowOf(r0[0]);
    if (!cl) throw new HttpError(404, 'not_found', 'Claim not found.');
    if (cl.status !== 'Pending') throw new HttpError(409, 'already_decided', `Claim is already ${cl.status}.`);
    const r1 = await exec([
      { op: 'get', table: 'Complaints', value: cl.complaint_id },
      { op: 'get', table: 'Found_Items', value: cl.item_id },
      { op: 'query', table: 'Claim_Requests', where: { item_id: cl.item_id, status: 'Approved' }, limit: 5 },
    ]);
    const c = rowOf(r1[0]);
    const f = rowOf(r1[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Linked complaint or item missing.');
    const t = iso();
    const settings = await getSettings();
    if (input.decision === 'approve') {
      const ch = input.checks;
      if (!ch || !ch.evidenceMatches || !ch.featuresMatch || !ch.noConflictingClaims) {
        throw new HttpError(422, 'checks_required', 'All verification checks must be confirmed before approval.');
      }
      if (rowsOf(r1[2]).length) throw new HttpError(409, 'conflict', 'Another claim for this item is already approved.');
      transition(c.status, 'Ready for Collection');
      const instructions = input.collectionInstructions || `Collect from ${settings.collection_office} (${settings.collection_hours}). Bring your college ID card and your Complaint ID. Your PIN is not needed at the counter — never share it.`;
      const r = await exec([
        { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Approved', reviewed_by: s.email, reviewed_at: t, decision_notes: input.notes, checks_json: JSON.stringify(ch) }, expectVersion: cl.version },
        { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Ready for Collection', linked_item_id: f.item_id, collection_instructions: instructions, updated_at: t }, expectVersion: c.version },
        { op: 'update', table: 'Found_Items', value: f.item_id, patch: { status: 'Claimed', matched_complaint_id: c.complaint_id, updated_at: t } },
        update(c.complaint_id, 'status', 'Ownership verified. Your item is ready for collection.', s.email, { itemId: f.item_id, data: { status: 'Ready for Collection' } }),
        log(s.email, 'claim_approved', 'Claim', cl.claim_id, input.notes),
      ]);
      mustOk(r, 5, 'claim');
    } else {
      const back: ComplaintStatus = 'Potential Match';
      transition(c.status, back);
      const r = await exec([
        { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Rejected', reviewed_by: s.email, reviewed_at: t, decision_notes: input.notes }, expectVersion: cl.version },
        { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: back, updated_at: t }, expectVersion: c.version },
        update(c.complaint_id, 'status', `Claim could not be verified: ${input.notes}`, s.email, { itemId: f.item_id, data: { status: back } }),
        log(s.email, 'claim_rejected', 'Claim', cl.claim_id, input.notes),
      ]);
      mustOk(r, 4, 'claim');
    }
    dashCache = null;
    return json({ ok: true });
  };

  const listHandovers: Handler = async ({ req }) => {
    await requireStaff(req);
    const r = await exec([
      { op: 'query', table: 'Claim_Requests', where: { status: 'Approved' }, limit: 100 },
      { op: 'query', table: 'Handover_Records', limit: 50 },
    ]);
    return json({ ok: true, ready: rowsOf(r[0]), recent: rowsOf(r[1]) });
  };

  const createHandover: Handler = async ({ req }) => {
    const s = await requireStaff(req);
    const input = parse(handoverInput, await readJson(req));
    const cl = rowOf((await exec([{ op: 'get', table: 'Claim_Requests', value: input.claimId }]))[0]);
    if (!cl) throw new HttpError(404, 'not_found', 'Claim not found.');
    if (cl.status !== 'Approved') throw new HttpError(409, 'not_approved', 'Only approved claims can be handed over.');
    const settings = await getSettings();
    if (settings.require_two_staff === 'true' && cl.reviewed_by === s.email) {
      throw new HttpError(409, 'two_staff_required', 'A different staff member must complete the handover.');
    }
    const r1 = await exec([
      { op: 'get', table: 'Complaints', value: cl.complaint_id },
      { op: 'get', table: 'Found_Items', value: cl.item_id },
    ]);
    const c = rowOf(r1[0]);
    const f = rowOf(r1[1]);
    if (!c || !f) throw new HttpError(404, 'not_found', 'Linked complaint or item missing.');
    transition(c.status, 'Returned');
    const t = iso();
    const handoverId = newId('HO');
    const r = await exec([
      { op: 'update', table: 'Claim_Requests', value: cl.claim_id, patch: { status: 'Completed' }, expectVersion: cl.version },
      { op: 'update', table: 'Complaints', value: c.complaint_id, patch: { status: 'Returned', updated_at: t, retention_until: retentionUntil(settings) }, expectVersion: c.version },
      { op: 'update', table: 'Found_Items', value: f.item_id, patch: { status: 'Returned', updated_at: t } },
      { op: 'append', table: 'Handover_Records', row: { handover_id: handoverId, created_at: t, complaint_id: c.complaint_id, item_id: f.item_id, claim_id: cl.claim_id, receiver_name: input.receiverName, receiver_id_checked: 'true', approved_by: cl.reviewed_by, handed_over_by: s.email, notes: input.notes } },
      update(c.complaint_id, 'status', 'Item handed over to you. Thank you for using FindBack.', s.email, { itemId: f.item_id, data: { status: 'Returned' } }),
      log(s.email, 'item_handed_over', 'Handover', handoverId, `${c.complaint_id} / ${f.item_id}`),
    ]);
    mustOk(r, 6, 'handover');
    dashCache = null;
    return json({ ok: true, handoverId }, 201);
  };

  const unclaimed: Handler = async ({ req }) => {
    await requireStaff(req);
    const settings = await getSettings();
    const days = Math.max(1, parseInt(settings.unclaimed_days || '60', 10) || 60);
    const cutoff = new Date(now() - days * 86400e3).toISOString().slice(0, 10);
    const r = await exec([{ op: 'query', table: 'Found_Items', where: { status: 'In Storage' }, limit: 2000, order: 'asc' }]);
    const rows = rowsOf(r[0]).filter((f) => f.found_date && f.found_date <= cutoff);
    return json({ ok: true, rows: rows.slice(0, 200), total: rows.length, days });
  };

  const activity: Handler = async ({ req, url }) => {
    await requireStaff(req);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const entity = url.searchParams.get('entity') ?? '';
    const r = await exec([{ op: 'query', table: 'Activity_Log', where: entity ? { entity } : {}, offset: (page - 1) * 50, limit: 50 }]);
    return json({ ok: true, rows: rowsOf(r[0]), total: (r[0] as { total?: number }).total ?? 0, page, pageSize: 50 });
  };

  const analytics: Handler = async ({ req }) => {
    await requireStaff(req);
    const r = await exec([
      { op: 'query', table: 'Complaints', columns: ['created_at', 'status', 'category', 'updated_at'], limit: 5000 },
      { op: 'query', table: 'Found_Items', columns: ['created_at', 'status', 'category'], limit: 5000 },
      { op: 'query', table: 'Handover_Records', columns: ['created_at', 'complaint_id'], limit: 5000 },
    ]);
    const complaints = rowsOf(r[0]);
    const items = rowsOf(r[1]);
    const handovers = rowsOf(r[2]);
    const byCategory: Record<string, { lost: number; found: number }> = {};
    for (const c of complaints) (byCategory[c.category] ??= { lost: 0, found: 0 }).lost++;
    for (const f of items) (byCategory[f.category] ??= { lost: 0, found: 0 }).found++;
    const weeks: { week: string; complaints: number; found: number; returned: number }[] = [];
    for (let w = 11; w >= 0; w--) {
      const start = now() - (w + 1) * 7 * 86400e3;
      const end = now() - w * 7 * 86400e3;
      const inRange = (s: string) => { const t = Date.parse(s); return t >= start && t < end; };
      weeks.push({ week: new Date(start).toISOString().slice(0, 10), complaints: complaints.filter((c) => inRange(c.created_at)).length, found: items.filter((f) => inRange(f.created_at)).length, returned: handovers.filter((h) => inRange(h.created_at)).length });
    }
    const createdById = new Map<string, string>();
    const created = rowsOf((await exec([{ op: 'query', table: 'Complaints', columns: ['complaint_id', 'created_at'], limit: 5000 }]))[0]);
    for (const c of created) createdById.set(c.complaint_id, c.created_at);
    const durations = handovers.map((h) => (Date.parse(h.created_at) - Date.parse(createdById.get(h.complaint_id) ?? h.created_at)) / 86400e3).filter((d) => d >= 0);
    const returned = complaints.filter((c) => c.status === 'Returned').length;
    return json({
      ok: true,
      totals: { complaints: complaints.length, foundItems: items.length, handovers: handovers.length, returned },
      recoveryRate: complaints.length ? Math.round((handovers.length / complaints.length) * 1000) / 10 : 0,
      avgDaysToReturn: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      byCategory,
      weeks,
    });
  };

  const getSettingsRoute: Handler = async ({ req }) => {
    const s = await requireStaff(req);
    settingsCache = null;
    return json({ ok: true, settings: await getSettings(), editable: s.role === 'admin', staffCount: staffList.size, staffDomain: env.STAFF_DOMAIN ?? '' });
  };

  const saveSettings: Handler = async ({ req }) => {
    const s = await requireStaff(req, 'admin');
    const body = await readJson<{ settings?: Record<string, unknown> }>(req);
    const incoming = body?.settings ?? {};
    const existing = rowsOf((await exec([{ op: 'query', table: 'Application_Settings', limit: 200 }]))[0]);
    const ops: Op[] = [];
    const t = iso();
    for (const key of EDITABLE_SETTINGS) {
      if (!(key in incoming)) continue;
      const value = String(incoming[key] ?? '').trim().slice(0, 300);
      if ((key === 'unclaimed_days' || key === 'retention_days') && !/^\d{1,4}$/.test(value)) throw new HttpError(422, 'validation_failed', `${key} must be a number of days.`, { [key]: 'Number of days' });
      if ((key === 'require_two_staff' || key === 'submissions_open') && !['true', 'false'].includes(value)) throw new HttpError(422, 'validation_failed', `${key} must be true or false.`);
      if (existing.some((r) => r.key === key)) ops.push({ op: 'update', table: 'Application_Settings', value: key, patch: { value, updated_at: t, updated_by: s.email } });
      else ops.push({ op: 'append', table: 'Application_Settings', row: { key, value, updated_at: t, updated_by: s.email } });
    }
    if (!ops.length) throw new HttpError(422, 'validation_failed', 'No settings changed.');
    ops.push(log(s.email, 'settings_updated', 'Settings', 'app', Object.keys(incoming).join(',')));
    mustOk(await exec(ops), ops.length, 'settings');
    settingsCache = null;
    return json({ ok: true });
  };

  const backup: Handler = async ({ req }) => {
    const s = await requireStaff(req, 'admin');
    const b = await store().backup();
    await exec([log(s.email, 'backup_created', 'Settings', b.backupId, b.name)]);
    return json({ ok: true, ...b });
  };

  const staffFile: Handler = async ({ req, params }) => {
    await requireStaff(req);
    return fileResponse(params.id);
  };

  // ------------------------------------------------------------ router
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/health$/, health],
    ['GET', /^\/api\/public\/config$/, publicConfig],
    ['POST', /^\/api\/complaints$/, createComplaint],
    ['POST', /^\/api\/access$/, access],
    ['GET', /^\/api\/portal$/, portal],
    ['POST', /^\/api\/portal\/update$/, portalUpdate],
    ['POST', /^\/api\/portal\/claim$/, portalClaim],
    ['POST', /^\/api\/portal\/close$/, portalClose],
    ['GET', /^\/api\/portal\/photo$/, portalPhoto],
    ['POST', /^\/api\/staff\/session$/, staffSession],
    ['POST', /^\/api\/staff\/dev-session$/, devStaffSession],
    ['GET', /^\/api\/staff\/me$/, staffMe],
    ['GET', /^\/api\/staff\/dashboard$/, dashboard],
    ['GET', /^\/api\/staff\/complaints$/, listComplaints],
    ['GET', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)$/, getComplaint],
    ['POST', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)\/status$/, setStatus],
    ['POST', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)\/note$/, addNote],
    ['POST', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)\/propose-match$/, proposeMatch],
    ['POST', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)\/withdraw-match$/, withdrawMatch],
    ['POST', /^\/api\/staff\/complaints\/(?<id>FB-[0-9A-Z-]{9}|1223)\/reset-pin$/, resetPin],
    ['GET', /^\/api\/staff\/found-items$/, listFound],
    ['POST', /^\/api\/staff\/found-items$/, createFound],
    ['GET', /^\/api\/staff\/found-items\/(?<id>FI-[0-9A-Z]{8})$/, getFound],
    ['POST', /^\/api\/staff\/found-items\/(?<id>FI-[0-9A-Z]{8})\/status$/, setFoundStatus],
    ['GET', /^\/api\/staff\/claims$/, listClaims],
    ['POST', /^\/api\/staff\/claims\/(?<id>CL-[0-9A-Z]{8})\/decision$/, decideClaim],
    ['GET', /^\/api\/staff\/handovers$/, listHandovers],
    ['POST', /^\/api\/staff\/handovers$/, createHandover],
    ['GET', /^\/api\/staff\/unclaimed$/, unclaimed],
    ['GET', /^\/api\/staff\/activity$/, activity],
    ['GET', /^\/api\/staff\/analytics$/, analytics],
    ['GET', /^\/api\/staff\/settings$/, getSettingsRoute],
    ['POST', /^\/api\/staff\/settings$/, saveSettings],
    ['POST', /^\/api\/staff\/backup$/, backup],
    ['GET', /^\/api\/staff\/files\/(?<id>[A-Za-z0-9_-]{8,100})$/, staffFile],
  ];

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, allowedOrigins);
    const reqId = crypto.randomUUID().slice(0, 8);
    const started = now();
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Browsers from non-allowed origins are refused outright (defence in depth beyond CORS).
    if (origin && !allowedOrigins.includes(origin)) return withHeaders(errorResponse(new HttpError(403, 'origin_not_allowed', 'Origin not allowed')), cors);
    let res: Response;
    try {
      // Cloudflare sets cf-connecting-ip; on Cloud Run the Google front end appends the real client IP as the last X-Forwarded-For entry.
      const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '0.0.0.0';
      await limit(limiters.api, `api:${ip}`);
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw new HttpError(404, 'not_found', 'Not found');
      const params = (route[1].exec(url.pathname)?.groups ?? {}) as Record<string, string>;
      res = await route[2]({ req, url, ip, params });
    } catch (e) {
      if (e instanceof HttpError) res = errorResponse(e);
      else if (e instanceof StoreError) {
        const map = {
          busy: [503, 'service_busy', 'The service is busy. Please retry in a few seconds.'],
          quota: [503, 'service_busy', 'The service is at capacity. Please retry in a minute.'],
          unavailable: [503, 'service_unavailable', 'The data service is temporarily unavailable. Nothing was saved unless confirmed.'],
          not_configured: [503, 'not_configured', 'The data service is not configured yet.'],
          rejected: [502, 'upstream_rejected', 'The data service rejected the request.'],
        } as const;
        const [status, code, msg] = map[e.code];
        res = json({ ok: false, error: code, message: msg }, status, { 'retry-after': '5' });
      } else {
        console.error(JSON.stringify({ reqId, path: url.pathname, error: String((e as Error)?.message ?? e).slice(0, 200) }));
        res = json({ ok: false, error: 'internal', message: 'Unexpected error. Please retry.' }, 500);
      }
    }
    // Structured access log: never includes bodies, PINs, tokens or personal data.
    console.log(JSON.stringify({ reqId, m: req.method, p: url.pathname.replace(/(FB|FI|CL)-[0-9A-Z-]+/g, '$1-*'), s: res.status, ms: now() - started }));
    return withHeaders(res, { ...cors, 'x-request-id': reqId });
  };
}
