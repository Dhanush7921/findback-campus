import { hashPin } from './crypto';
import type { MemoryStore } from './store/memory';

/** Development-only demo complaint (ID 1223). Never seeded when APP_ENV is not "development". */
export const DEMO_COMPLAINT_ID = '1223';
export const DEMO_PIN = '1223-1223-12';

export async function seedDemo(store: MemoryStore, pepper: string) {
  const t = new Date().toISOString();
  await store.exec([
    {
      op: 'append', table: 'Complaints',
      row: {
        complaint_id: DEMO_COMPLAINT_ID, created_at: t, updated_at: t, status: 'Submitted', idempotency_key: 'demo',
        name: 'Demo Student', student_id: 'DEMO001', department: 'CSE — III Year', phone: '+91 90000 00000', email: '',
        category: 'Bag / Backpack', item_name: 'Blue backpack', description: 'Navy blue backpack with laptop sleeve and a keychain',
        color_features: 'Navy blue, white logo, robot keychain', last_seen_location: 'Library reading hall', lost_date: t.slice(0, 10),
        lost_time: '14:30', photo_file_id: '', ownership_evidence: 'Notebook inside has my name on the first page', extra_info: '',
        linked_item_id: '', collection_instructions: '', staff_notes: '', retention_until: '', version: '1',
      },
    },
    { op: 'append', table: 'Access_Credentials', row: { complaint_id: DEMO_COMPLAINT_ID, pin_hash: await hashPin(pepper, DEMO_COMPLAINT_ID, DEMO_PIN), created_at: t, failed_attempts: '0', locked_until: '', last_success_at: '', rotated_at: '', version: '1' } },
    { op: 'append', table: 'Complaint_Updates', row: { update_id: 'UP-DEMO0001', created_at: t, complaint_id: DEMO_COMPLAINT_ID, type: 'status', message: 'Complaint submitted', item_id: '', data_json: '{"status":"Submitted"}', visible_to_student: 'true', actor: 'student' } },
  ]);
}
