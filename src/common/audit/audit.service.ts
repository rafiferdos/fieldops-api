import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

// Add explicit event variants as domains grow; arbitrary JSON is not accepted.
type AuditTarget = {
  actorId: string | null;
  entityId: string;
};

export type AuditEvent = AuditTarget &
  (
    | {
        action: 'USER_PROFILE_UPDATED';
        entityType: 'USER';
        metadata: { updatedFields: Array<'name' | 'phone'> };
      }
    | {
        action: 'ADMIN_BOOTSTRAPPED';
        entityType: 'USER';
        metadata: Record<string, never>;
      }
    | {
        action: 'REQUEST_CREATED';
        entityType: 'REQUEST';
        metadata: { serviceId: string; status: 'PENDING'; version: 1 };
      }
    | {
        action: 'SERVICE_CREATED';
        entityType: 'SERVICE';
        metadata: { basePriceMinor: number; currency: 'BDT' };
      }
    | {
        action: 'SERVICE_UPDATED';
        entityType: 'SERVICE';
        metadata: {
          updatedFields: Array<'name' | 'description' | 'basePriceMinor'>;
          previousBasePriceMinor: number;
          basePriceMinor: number;
        };
      }
    | {
        action: 'SERVICE_DELETED';
        entityType: 'SERVICE';
        metadata: Record<string, never>;
      }
  );

@Injectable()
export class AuditService {
  record(tx: Prisma.TransactionClient, event: AuditEvent) {
    // The caller owns the transaction, so the write and its audit commit together.
    return tx.auditLog.create({ data: event, select: { id: true } });
  }
}
