import { createContext, useContext } from 'react';

export interface PortalData {
  complaint: {
    complaintId: string; createdAt: string; updatedAt: string; status: string; name: string; studentId: string; department: string;
    phone: string; email: string; category: string; itemName: string; description: string; colorFeatures: string; lastSeenLocation: string;
    lostDate: string; lostTime: string; hasPhoto: boolean; ownershipEvidence: string; extraInfo: string; collectionInstructions: string;
  };
  timeline: { status: string; at: string; message: string }[];
  notifications: { id: string; type: string; message: string; at: string }[];
  matches: { itemId: string; proposedAt: string; note: string; item: { category?: string; itemName?: string; description?: string; colorFeatures?: string; foundLocation?: string; foundDate?: string }; claimStatus: string | null }[];
  claims: { claimId: string; itemId: string; status: string; createdAt: string; decisionNotes: string }[];
  collection: { office: string; hours: string; instructions: string; contactEmail: string; contactPhone: string };
  sessionExpiresAt: number;
}
export const PortalCtx = createContext<{ data: PortalData; reload: () => Promise<void> } | null>(null);
export function usePortal() {
  const c = useContext(PortalCtx);
  if (!c) throw new Error('usePortal outside portal');
  return c;
}
