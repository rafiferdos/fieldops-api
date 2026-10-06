import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

// Add explicit event variants as domains grow; arbitrary JSON is not accepted.
export type AuditEvent = {
  actorId: string | null;
  action: 'USER_PROFILE_UPDATED';
  entityType: 'USER';
  entityId: string;
  metadata: { updatedFields: Array<'name' | 'phone'> };
};

@Injectable()
export class AuditService {
  record(tx: Prisma.TransactionClient, event: AuditEvent) {
    // The caller owns the transaction, so the write and its audit commit together.
    return tx.auditLog.create({ data: event, select: { id: true } });
  }
}
