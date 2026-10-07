import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

// Add explicit event variants as domains grow; arbitrary JSON is not accepted.
type PaymentState =
  | 'INITIATING'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVIEW'
  | 'UNKNOWN';

type AuditTarget = {
  actorId: string | null;
  entityId: string;
};

export type AuditEvent = AuditTarget &
  (
    | {
        action: 'PAYMENT_SETTLED';
        entityType: 'PAYMENT';
        metadata: {
          invoiceId: string;
          receiptId: string;
          amountMinor: number;
          currency: 'BDT';
        };
      }
    | {
        action: 'INVOICE_PAID';
        entityType: 'INVOICE';
        metadata: { paymentId: string; amountMinor: number; currency: 'BDT' };
      }
    | {
        action: 'PAYMENT_RECEIPT_REVIEW';
        entityType: 'PAYMENT';
        metadata: { invoiceId: string; receiptId: string; reason: string };
      }
    | {
        action: 'PAYMENT_INITIATED';
        entityType: 'PAYMENT';
        metadata: {
          invoiceId: string;
          amountMinor: number;
          currency: 'BDT';
          status: 'INITIATING';
        };
      }
    | {
        action: 'PAYMENT_STATE_CHANGED';
        entityType: 'PAYMENT';
        metadata: {
          invoiceId: string;
          fromStatus: PaymentState;
          toStatus: PaymentState;
        };
      }
    | {
        action: 'WORK_ORDER_COMPLETED';
        entityType: 'WORK_ORDER';
        metadata: {
          fromStatus: 'IN_PROGRESS';
          toStatus: 'COMPLETED';
          previousVersion: number;
          version: number;
          invoiceId: string;
        };
      }
    | {
        action: 'INVOICE_ISSUED';
        entityType: 'INVOICE';
        metadata: {
          workOrderId: string;
          amountMinor: number;
          currency: 'BDT';
          status: 'UNPAID';
        };
      }
    | {
        action: 'WORK_ORDER_ASSIGNED';
        entityType: 'WORK_ORDER';
        metadata: {
          requestId: string;
          technicianId: string;
          start: string;
          end: string;
          agreedPriceMinor: number;
          currency: 'BDT';
          version: 1;
        };
      }
    | {
        action: 'WORK_ORDER_RESCHEDULED';
        entityType: 'WORK_ORDER';
        metadata: {
          previousTechnicianId: string;
          technicianId: string;
          previousStart: string;
          previousEnd: string;
          start: string;
          end: string;
          previousVersion: number;
          version: number;
        };
      }
    | {
        action: 'WORK_ORDER_STATUS_CHANGED';
        entityType: 'WORK_ORDER';
        metadata: {
          fromStatus: 'ASSIGNED' | 'EN_ROUTE';
          toStatus: 'EN_ROUTE' | 'IN_PROGRESS';
          previousVersion: number;
          version: number;
        };
      }
    | {
        action: 'WORK_ORDER_CANCELLED';
        entityType: 'WORK_ORDER';
        metadata: {
          requestId: string;
          fromStatus: 'ASSIGNED';
          toStatus: 'CANCELLED';
          previousVersion: number;
          version: number;
        };
      }
    | {
        action: 'USER_PROFILE_UPDATED';
        entityType: 'USER';
        metadata: { updatedFields: Array<'name' | 'phone'> };
      }
    | {
        action: 'TECHNICIAN_SKILLS_UPDATED';
        entityType: 'USER';
        metadata: { serviceIds: string[] };
      }
    | {
        action: 'ADMIN_BOOTSTRAPPED' | 'TECHNICIAN_BOOTSTRAPPED';
        entityType: 'USER';
        metadata: Record<string, never>;
      }
    | {
        action: 'REQUEST_CREATED';
        entityType: 'REQUEST';
        metadata: { serviceId: string; status: 'PENDING'; version: 1 };
      }
    | {
        action: 'REQUEST_UPDATED';
        entityType: 'REQUEST';
        metadata: {
          updatedFields: Array<'description' | 'address' | 'preferredStart'>;
          previousVersion: number;
          version: number;
        };
      }
    | {
        action: 'REQUEST_REVIEWED';
        entityType: 'REQUEST';
        metadata: {
          fromStatus: 'PENDING';
          toStatus: 'APPROVED' | 'REJECTED';
          previousVersion: number;
          version: number;
        };
      }
    | {
        action: 'REQUEST_CANCELLED';
        entityType: 'REQUEST';
        metadata: {
          fromStatus: 'PENDING' | 'APPROVED';
          toStatus: 'CANCELLED';
          previousVersion: number;
          version: number;
        };
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
