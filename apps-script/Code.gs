/**
 * FindBack — Google Apps Script data layer.
 *
 * This is a deliberately thin, generic table service over the private
 * spreadsheet. All business rules (PIN hashing, sessions, authorization,
 * status transitions) live in the Cloudflare Worker gateway. This script only
 * accepts requests signed with the shared HMAC secret held by the Worker.
 *
 * Deploy: Extensions → Apps Script in the FindBack spreadsheet, paste this file
 * and appsscript.json, run setupFindBack() once, then Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone). See docs/DEPLOYMENT.md.
 */

var FB_SCHEMA = {
  Complaints: ['complaint_id', 'created_at', 'updated_at', 'status', 'idempotency_key',
    'name', 'student_id', 'department', 'phone', 'email',
    'category', 'item_name', 'description', 'color_features', 'last_seen_location',
    'lost_date', 'lost_time', 'photo_file_id', 'ownership_evidence', 'extra_info',
    'linked_item_id', 'collection_instructions', 'staff_notes', 'retention_until', 'version'],
  Access_Credentials: ['complaint_id', 'pin_hash', 'created_at', 'failed_attempts', 'locked_until',
    'last_success_at', 'rotated_at', 'version'],
  Found_Items: ['item_id', 'created_at', 'updated_at', 'status', 'category', 'item_name',
    'public_description', 'private_details', 'color_features', 'found_location', 'found_date',
    'storage_location', 'photo_file_ids', 'registered_by', 'matched_complaint_id', 'version'],
  Claim_Requests: ['claim_id', 'created_at', 'complaint_id', 'item_id', 'evidence', 'status',
    'reviewed_by', 'reviewed_at', 'decision_notes', 'checks_json', 'version'],
  Complaint_Updates: ['update_id', 'created_at', 'complaint_id', 'type', 'message', 'item_id',
    'data_json', 'visible_to_student', 'actor'],
  Handover_Records: ['handover_id', 'created_at', 'complaint_id', 'item_id', 'claim_id',
    'receiver_name', 'receiver_id_checked', 'approved_by', 'handed_over_by', 'notes'],
  Activity_Log: ['log_id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'details'],
  Application_Settings: ['key', 'value', 'updated_at', 'updated_by']
};
var FB_KEYS = {
  Complaints: 'complaint_id', Access_Credentials: 'complaint_id', Found_Items: 'item_id',
  Claim_Requests: 'claim_id', Complaint_Updates: 'update_id', Handover_Records: 'handover_id',
  Activity_Log: 'log_id', Application_Settings: 'key'
};
var FB_MAX_SKEW_MS = 5 * 60 * 1000;
var FB_MAX_FILE_BYTES = 3 * 1024 * 1024;
var FB_ALLOWED_MIME = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

// ---------------------------------------------------------------- HTTP entry

function doPost(e) {
  var out;
  try {
    out = fbHandle_(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    // Never leak stack traces or data in errors.
    out = { ok: false, error: 'internal', message: String(err && err.message || err).slice(0, 200) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'findback-data' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fbHandle_(raw) {
  if (!raw || raw.length > 6 * 1024 * 1024) return { ok: false, error: 'bad_request' };
  var env = JSON.parse(raw);
  var secret = PropertiesService.getScriptProperties().getProperty('FB_SHARED_SECRET');
  if (!secret) return { ok: false, error: 'not_configured' };
  if (typeof env.ts !== 'number' || typeof env.nonce !== 'string' || typeof env.body !== 'string' || typeof env.sig !== 'string') {
    return { ok: false, error: 'bad_request' };
  }
  if (Math.abs(Date.now() - env.ts) > FB_MAX_SKEW_MS) return { ok: false, error: 'stale' };
  var expected = fbHmacHex_(secret, env.ts + '.' + env.nonce + '.' + env.body);
  if (!fbSafeEqual_(expected, env.sig)) return { ok: false, error: 'unauthorized' };
  var cache = CacheService.getScriptCache();
  var nonceKey = 'n:' + env.nonce;
  if (cache.get(nonceKey)) return { ok: false, error: 'replay' };
  cache.put(nonceKey, '1', 600);

  var req = JSON.parse(env.body);
  switch (req.action) {
    case 'ping': return { ok: true, time: new Date().toISOString() };
    case 'exec': return fbExec_(req.ops || []);
    case 'uploadFile': return fbUpload_(req);
    case 'getFile': return fbGetFile_(req);
    case 'deleteFile': return fbDeleteFile_(req);
    case 'backup': return fbBackup_();
    default: return { ok: false, error: 'unknown_action' };
  }
}

function fbHmacHex_(secret, msg) {
  var bytes = Utilities.computeHmacSha256Signature(msg, secret, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function fbSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- Table ops

/**
 * Runs ops sequentially. Any op that writes makes the whole batch run under
 * the script lock, so read-check-write sequences (unique keys, versions) are
 * atomic with respect to other requests. Stops at the first failing op.
 */
function fbExec_(ops) {
  if (!ops.length || ops.length > 25) return { ok: false, error: 'bad_request' };
  var writes = false;
  for (var i = 0; i < ops.length; i++) if (ops[i].op === 'append' || ops[i].op === 'update') writes = true;
  var lock = null;
  if (writes) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return { ok: false, error: 'busy' };
  }
  try {
    var ss = fbSpreadsheet_();
    var results = [];
    for (var j = 0; j < ops.length; j++) {
      var r = fbRunOp_(ss, ops[j]);
      results.push(r);
      if (r.ok === false) break;
    }
    if (writes) SpreadsheetApp.flush();
    return { ok: true, results: results };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function fbRunOp_(ss, op) {
  var cols = FB_SCHEMA[op.table];
  if (!cols) return { ok: false, error: 'unknown_table' };
  var sheet = ss.getSheetByName(op.table);
  if (!sheet) return { ok: false, error: 'not_setup' };
  switch (op.op) {
    case 'get': {
      var found = fbFind_(sheet, cols, op.by || FB_KEYS[op.table], String(op.value));
      return { ok: true, row: found ? found.row : null };
    }
    case 'query': return fbQuery_(sheet, cols, op);
    case 'append': {
      if (op.unique) {
        var dup = fbFind_(sheet, cols, op.unique, String(op.row[op.unique] || ''));
        if (dup) return { ok: false, error: 'duplicate', row: dup.row };
      }
      var key = FB_KEYS[op.table];
      if (op.table !== 'Activity_Log' && op.table !== 'Complaint_Updates') {
        var keyDup = fbFind_(sheet, cols, key, String(op.row[key] || ''));
        if (keyDup) return { ok: false, error: 'duplicate_key' };
      }
      var values = cols.map(function (c) { return fbCell_(op.row[c]); });
      sheet.appendRow(values);
      return { ok: true, row: fbRowObj_(cols, values) };
    }
    case 'update': {
      var hit = fbFind_(sheet, cols, op.by || FB_KEYS[op.table], String(op.value));
      if (!hit) return { ok: false, error: 'not_found' };
      if (op.expectVersion != null && String(hit.row.version || '0') !== String(op.expectVersion)) {
        return { ok: false, error: 'conflict', row: hit.row };
      }
      var next = {};
      for (var c in hit.row) next[c] = hit.row[c];
      for (var p in op.patch) if (cols.indexOf(p) >= 0 && p !== FB_KEYS[op.table]) next[p] = String(op.patch[p]);
      if (cols.indexOf('version') >= 0) next.version = String((parseInt(hit.row.version || '0', 10) || 0) + 1);
      var vals = cols.map(function (cc) { return fbCell_(next[cc]); });
      sheet.getRange(hit.rowIndex, 1, 1, cols.length).setValues([vals]);
      return { ok: true, row: fbRowObj_(cols, vals) };
    }
    default: return { ok: false, error: 'unknown_op' };
  }
}

/** Escape formula injection and coerce to string. */
function fbCell_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function fbRowObj_(cols, values) {
  var o = {};
  for (var i = 0; i < cols.length; i++) {
    var v = values[i];
    if (v instanceof Date) v = v.toISOString();
    v = v === null || v === undefined ? '' : String(v);
    if (v.charAt(0) === "'" && /^'[=+\-@\t\r]/.test(v)) v = v.slice(1);
    o[cols[i]] = v;
  }
  return o;
}

/** Exact-match lookup on one column via TextFinder (fast, no full read). */
function fbFind_(sheet, cols, column, value) {
  if (!value) return null;
  var ci = cols.indexOf(column);
  if (ci < 0) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var range = sheet.getRange(2, ci + 1, last - 1, 1);
  var cell = range.createTextFinder(value).matchEntireCell(true).matchCase(true).findNext();
  if (!cell) return null;
  var rowIndex = cell.getRow();
  var vals = sheet.getRange(rowIndex, 1, 1, cols.length).getValues()[0];
  return { rowIndex: rowIndex, row: fbRowObj_(cols, vals) };
}

/** Equality filters, newest-first by default, paginated. */
function fbQuery_(sheet, cols, op) {
  var limit = Math.min(Math.max(parseInt(op.limit || 50, 10), 1), 5000);
  var offset = Math.max(parseInt(op.offset || 0, 10), 0);
  var where = op.where || {};
  var keys = Object.keys(where);
  var last = sheet.getLastRow();
  if (last < 2) return { ok: true, rows: [], total: 0 };
  var rows = [];
  if (keys.length && cols.indexOf(keys[0]) >= 0 && where[keys[0]] !== '') {
    // Narrow with TextFinder on the first filter column, then read only hit rows.
    var ci = cols.indexOf(keys[0]);
    var cells = sheet.getRange(2, ci + 1, last - 1, 1).createTextFinder(String(where[keys[0]]))
      .matchEntireCell(true).matchCase(true).findAll();
    if (cells.length > 300) {
      rows = sheet.getRange(2, 1, last - 1, cols.length).getValues().map(function (v) { return fbRowObj_(cols, v); });
    } else {
      for (var i = 0; i < cells.length; i++) {
        rows.push(fbRowObj_(cols, sheet.getRange(cells[i].getRow(), 1, 1, cols.length).getValues()[0]));
      }
    }
  } else {
    rows = sheet.getRange(2, 1, last - 1, cols.length).getValues().map(function (v) { return fbRowObj_(cols, v); });
  }
  rows = rows.filter(function (r) {
    for (var k = 0; k < keys.length; k++) if (where[keys[k]] !== '' && r[keys[k]] !== String(where[keys[k]])) return false;
    return true;
  });
  if (op.since) rows = rows.filter(function (r) { return r.created_at >= op.since; });
  rows.sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; });
  if (op.order !== 'asc') rows.reverse();
  var total = rows.length;
  if (op.columns && op.columns.length) {
    rows = rows.map(function (r) { var o = {}; op.columns.forEach(function (c) { o[c] = r[c]; }); return o; });
  }
  return { ok: true, rows: rows.slice(offset, offset + limit), total: total };
}

// ---------------------------------------------------------------- Files (Drive)

function fbFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('FB_MEDIA_FOLDER_ID');
  if (!id) throw new Error('media folder not configured');
  return DriveApp.getFolderById(id);
}

function fbUpload_(req) {
  if (!FB_ALLOWED_MIME[req.mime]) return { ok: false, error: 'bad_type' };
  var bytes = Utilities.base64Decode(req.dataBase64 || '');
  if (!bytes.length || bytes.length > FB_MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
  var name = String(req.name || 'upload').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  var file = fbFolder_().createFile(Utilities.newBlob(bytes, req.mime, name));
  // Files inherit the private folder's sharing (owner only). Never share publicly.
  return { ok: true, fileId: file.getId() };
}

function fbOwnedFile_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(fileId || ''))) return null;
  var folderId = PropertiesService.getScriptProperties().getProperty('FB_MEDIA_FOLDER_ID');
  try {
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folderId) return file;
  } catch (e) { /* not found */ }
  return null;
}

function fbGetFile_(req) {
  var file = fbOwnedFile_(req.fileId);
  if (!file) return { ok: false, error: 'not_found' };
  var blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), dataBase64: Utilities.base64Encode(blob.getBytes()) };
}

function fbDeleteFile_(req) {
  var file = fbOwnedFile_(req.fileId);
  if (!file) return { ok: false, error: 'not_found' };
  file.setTrashed(true);
  return { ok: true };
}

// ---------------------------------------------------------------- Setup, backup, retention

function fbSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('FB_SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Run once from the editor. Creates tabs with headers (plain-text format),
 * a private Drive media folder and backup folder, generates the shared secret,
 * and installs daily backup + retention triggers. Safe to re-run.
 */
function setupFindBack() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('FB_SPREADSHEET_ID', ss.getId());
  Object.keys(FB_SCHEMA).forEach(function (name) {
    var cols = FB_SCHEMA[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#d9f2ea');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sh.protect().setDescription('FindBack managed sheet — edit via the staff dashboard').setWarningOnly(true);
    }
  });
  if (!props.getProperty('FB_MEDIA_FOLDER_ID')) {
    props.setProperty('FB_MEDIA_FOLDER_ID', DriveApp.createFolder('FindBack Media (private)').getId());
  }
  if (!props.getProperty('FB_BACKUP_FOLDER_ID')) {
    props.setProperty('FB_BACKUP_FOLDER_ID', DriveApp.createFolder('FindBack Backups (private)').getId());
  }
  var created = false;
  if (!props.getProperty('FB_SHARED_SECRET')) {
    props.setProperty('FB_SHARED_SECRET', fbRandomSecret_());
    created = true;
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'dailyBackup' || f === 'retentionSweep') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('retentionSweep').timeBased().everyDays(1).atHour(3).create();
  Logger.log('FindBack setup complete. Tabs, private folders and daily triggers are ready.');
  if (created) {
    Logger.log('Generated a new shared secret. Run showSharedSecret() and copy it into the GAS_SHARED_SECRET GitHub secret.');
  } else {
    Logger.log('Existing shared secret kept. Run showSharedSecret() if you need it again.');
  }
}

function showSharedSecret() {
  Logger.log('GAS_SHARED_SECRET = ' + PropertiesService.getScriptProperties().getProperty('FB_SHARED_SECRET'));
}

/** Rotate the shared secret (then update the Worker secret GAS_SHARED_SECRET). */
function rotateSharedSecret() {
  PropertiesService.getScriptProperties().setProperty('FB_SHARED_SECRET', fbRandomSecret_());
  showSharedSecret();
}

function fbRandomSecret_() {
  var s = '';
  for (var i = 0; i < 4; i++) s += Utilities.getUuid().replace(/-/g, '');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s + Date.now() + Math.random());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '') + s.slice(0, 16);
}

function fbBackup_() {
  var props = PropertiesService.getScriptProperties();
  var folder = DriveApp.getFolderById(props.getProperty('FB_BACKUP_FOLDER_ID'));
  var ss = fbSpreadsheet_();
  var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HHmm'Z'");
  var copy = DriveApp.getFileById(ss.getId()).makeCopy('FindBack backup ' + stamp, folder);
  // Keep the newest 14 backups.
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = 14; i < files.length; i++) files[i].setTrashed(true);
  return { ok: true, backupId: copy.getId(), name: copy.getName() };
}

function dailyBackup() { fbBackup_(); }

/**
 * Redacts personal data of complaints past retention_until that are Returned
 * or Closed, and trashes their photos. Keeps anonymous records for analytics.
 */
function retentionSweep() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    var ss = fbSpreadsheet_();
    var sh = ss.getSheetByName('Complaints');
    var cols = FB_SCHEMA.Complaints;
    var last = sh.getLastRow();
    if (last < 2) return;
    var data = sh.getRange(2, 1, last - 1, cols.length).getValues();
    var now = new Date().toISOString();
    var redact = ['name', 'student_id', 'phone', 'email', 'ownership_evidence', 'extra_info', 'photo_file_id'];
    for (var i = 0; i < data.length; i++) {
      var r = fbRowObj_(cols, data[i]);
      if ((r.status === 'Returned' || r.status === 'Closed') && r.retention_until && r.retention_until < now && r.name !== '[redacted]') {
        if (r.photo_file_id) fbDeleteFile_({ fileId: r.photo_file_id });
        redact.forEach(function (c) { r[c] = c === 'photo_file_id' ? '' : '[redacted]'; });
        sh.getRange(i + 2, 1, 1, cols.length).setValues([cols.map(function (c) { return fbCell_(r[c]); })]);
      }
    }
  } finally {
    lock.releaseLock();
  }
}
