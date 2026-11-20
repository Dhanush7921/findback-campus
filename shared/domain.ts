import { z } from 'zod';

/** Complaint lifecycle. Order matters for the student timeline. */
export const COMPLAINT_STATUSES = [
  'Submitted',
  'Under Review',
  'Potential Match',
  'Ownership Verification',
  // Kept for records created by FindBack V1. New V2 flows use
  // "Ownership Verification".
  'Awaiting Verification',
  'Ready for Collection',
  'Awaiting Receiver Confirmation',
  'Returned',
  'Closed',
  'Rejected',
  'Cancelled',
  'Unclaimed',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Server-enforced status transitions (staff actions). */
export const STATUS_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  Submitted: ['Under Review', 'Potential Match', 'Cancelled', 'Rejected', 'Closed'],
  'Under Review': ['Potential Match', 'Rejected', 'Cancelled', 'Closed'],
  'Potential Match': ['Under Review', 'Ownership Verification', 'Awaiting Verification', 'Rejected', 'Cancelled', 'Closed'],
  'Ownership Verification': ['Potential Match', 'Under Review', 'Ready for Collection', 'Rejected', 'Cancelled', 'Closed'],
  'Awaiting Verification': ['Potential Match', 'Under Review', 'Ready for Collection', 'Rejected', 'Cancelled', 'Closed'],
  'Ready for Collection': ['Awaiting Receiver Confirmation', 'Under Review', 'Unclaimed', 'Cancelled', 'Closed'],
  'Awaiting Receiver Confirmation': ['Returned', 'Ready for Collection', 'Cancelled'],
  Returned: ['Closed'],
  Closed: [],
  Rejected: [],
  Cancelled: [],
  Unclaimed: ['Ready for Collection', 'Closed'],
};

export const FOUND_ITEM_STATUSES = ['In Storage', 'Matched', 'Claimed', 'Returned', 'Donated', 'Disposed'] as const;
export type FoundItemStatus = (typeof FOUND_ITEM_STATUSES)[number];

export const CLAIM_STATUSES = ['Pending', 'Approved', 'Rejected', 'Completed', 'Withdrawn'] as const;

export const CATEGORIES = [
  'Electronics',
  'Mobile Phone',
  'Laptop / Tablet',
  'ID Card / Documents',
  'Wallet / Purse',
  'Keys',
  'Bag / Backpack',
  'Books / Stationery',
  'Clothing',
  'Jewellery / Watch',
  'Water Bottle / Lunch Box',
  'Sports Equipment',
  'Other',
] as const;

/** Sheet schemas: the single source of truth for column order. */
export const TABLES = {
  Complaints: [
    'complaint_id', 'created_at', 'updated_at', 'status', 'idempotency_key',
    'name', 'student_id', 'department', 'phone', 'email',
    'category', 'item_name', 'description', 'color_features', 'last_seen_location',
    'lost_date', 'lost_time', 'photo_file_id', 'ownership_evidence', 'extra_info',
    'linked_item_id', 'collection_instructions', 'staff_notes', 'retention_until', 'version',
    'reporter_uid', 'reporter_kind', 'reporter_phone', 'reporter_verified_at',
    'identity_ref', 'identity_status', 'submission_source', 'guest_ref', 'deleted_at', 'deleted_by',
  ],
  Access_Credentials: [
    'complaint_id', 'pin_hash', 'created_at', 'failed_attempts', 'locked_until',
    'last_success_at', 'rotated_at', 'version',
  ],
  Found_Items: [
    'item_id', 'created_at', 'updated_at', 'status', 'category', 'item_name',
    'public_description', 'private_details', 'color_features', 'found_location', 'found_date',
    'storage_location', 'photo_file_ids', 'registered_by', 'matched_complaint_id', 'version',
  ],
  Claim_Requests: [
    'claim_id', 'created_at', 'complaint_id', 'item_id', 'evidence', 'status',
    'reviewed_by', 'reviewed_at', 'decision_notes', 'checks_json', 'version',
  ],
  Complaint_Updates: [
    'update_id', 'created_at', 'complaint_id', 'type', 'message', 'item_id',
    'data_json', 'visible_to_student', 'actor',
  ],
  Handover_Records: [
    'handover_id', 'created_at', 'complaint_id', 'item_id', 'claim_id',
    'receiver_name', 'receiver_id_checked', 'approved_by', 'handed_over_by', 'notes',
    'state', 'challenge_hash', 'challenge_expires_at', 'challenge_used_at',
    'receiver_uid', 'receiver_kind', 'receiver_confirmed_at', 'receiver_acknowledgment',
    'receiver_evidence_file_id', 'owner_authorization', 'staff_confirmed_at', 'version',
  ],
  Activity_Log: [
    'log_id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'details',
    'actor_role', 'before_status', 'after_status', 'authorization_result', 'evidence_ref', 'request_id',
  ],
  Application_Settings: ['key', 'value', 'updated_at', 'updated_by'],
} as const;
export type TableName = keyof typeof TABLES;
export type Row = Record<string, string>;

/** Key column per table (unique, used for get/update). */
export const TABLE_KEYS: Record<TableName, string> = {
  Complaints: 'complaint_id',
  Access_Credentials: 'complaint_id',
  Found_Items: 'item_id',
  Claim_Requests: 'claim_id',
  Complaint_Updates: 'update_id',
  Handover_Records: 'handover_id',
  Activity_Log: 'log_id',
  Application_Settings: 'key',
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  collection_office: 'Student Affairs Office, Ground Floor, Admin Block',
  collection_hours: 'Mon–Sat, 10:00 AM – 4:30 PM',
  contact_email: '',
  contact_phone: '',
  unclaimed_days: '60',
  retention_days: '180',
  require_two_staff: 'false',
  submissions_open: 'true',
};
export const EDITABLE_SETTINGS = Object.keys(DEFAULT_SETTINGS);

// ---------- Validation (shared by frontend and backend) ----------
/* eslint-disable no-control-regex -- intentionally strips control characters */
const clean = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(min).max(max));
const optionalClean = (max: number) =>
  z
    .string()
    .optional()
    .default('')
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));

export const PHONE_RE = /^\+?[0-9][0-9\s-]{7,15}$/;
export const COMPLAINT_ID_RE = /^FB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
export const PIN_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/;

export const complaintInput = z
  .object({
    name: clean(80, 2),
    studentId: clean(30, 2).refine((v) => /^[A-Za-z0-9/_.-]+$/.test(v), 'Use letters, numbers, / _ . -'),
    department: clean(80, 2),
    phone: optionalClean(20).refine((v) => v === '' || PHONE_RE.test(v), 'Enter a valid phone number'),
    email: optionalClean(120).refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email'),
    category: z.enum(CATEGORIES),
    itemName: clean(80, 2),
    description: clean(1000, 10),
    colorFeatures: clean(300, 2),
    lastSeenLocation: clean(160, 2),
    lostDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    lostTime: optionalClean(5).refine((v) => v === '' || /^\d{2}:\d{2}$/.test(v), 'Invalid time'),
    ownershipEvidence: clean(1000, 10),
  })
  .refine((v) => v.phone !== '' || v.email !== '', { message: 'Give a phone number or email', path: ['phone'] })
  .refine(
    (v) => {
      const d = Date.parse(v.lostDate + 'T00:00:00Z');
      return !Number.isNaN(d) && d <= Date.now() + 36 * 3600e3 && d >= Date.now() - 400 * 86400e3;
    },
    { message: 'Date must be within the last year and not in the future', path: ['lostDate'] },
  );
export type ComplaintInput = z.input<typeof complaintInput>;

export const imageUpload = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().max(4_200_000), // ~3 MB decoded
});
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const accessInput = z.object({
  complaintId: z.string().trim().toUpperCase().pipe(z.string().regex(COMPLAINT_ID_RE, 'Invalid Complaint ID format')),
  pin: z.string().trim().toUpperCase().pipe(z.string().regex(PIN_RE, 'Invalid PIN format')),
});

export const portalUpdateInput = z.object({
  phone: optionalClean(20).refine((v) => v === '' || PHONE_RE.test(v), 'Enter a valid phone number'),
  email: optionalClean(120).refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email'),
  extraInfo: optionalClean(1000),
});

export const claimInput = z.object({
  itemId: z.string().regex(/^FI-[0-9A-HJKMNP-TV-Z]{8}$/),
  evidence: clean(1000, 10),
});

export const foundItemInput = z.object({
  category: z.enum(CATEGORIES),
  itemName: clean(80, 2),
  publicDescription: clean(500, 5),
  privateDetails: optionalClean(1000),
  colorFeatures: clean(300, 2),
  foundLocation: clean(160, 2),
  foundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  storageLocation: clean(120, 2),
});

export const statusUpdateInput = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  note: optionalClean(500),
  collectionInstructions: optionalClean(500),
});

export const claimDecisionInput = z.object({
  decision: z.enum(['approve', 'reject']),
  notes: clean(500, 3),
  checks: z
    .object({
      evidenceMatches: z.boolean(),
      featuresMatch: z.boolean(),
      noConflictingClaims: z.boolean(),
    })
    .optional(),
  collectionInstructions: optionalClean(500),
});

export const handoverInput = z.object({
  claimId: z.string().regex(/^CL-[0-9A-HJKMNP-TV-Z]{8}$/),
  receiverName: clean(80, 2),
  receiverIdChecked: z.literal(true),
  notes: optionalClean(500),
});

/** Status rank for timeline rendering. */
export function statusRank(s: string): number {
  return COMPLAINT_STATUSES.indexOf(s as ComplaintStatus);
}
