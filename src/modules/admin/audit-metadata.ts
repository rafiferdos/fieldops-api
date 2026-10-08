import type { Prisma } from '../../generated/prisma/client.js';
import type { AuditEvent } from '../../common/audit/audit.service.js';

const allowedFields = {
  ADMIN_BOOTSTRAPPED: [],
  TECHNICIAN_BOOTSTRAPPED: [],
  USER_PROFILE_UPDATED: ['updatedFields'],
  USER_ACCESS_UPDATED: ['previousRole', 'role', 'previousStatus', 'status'],
  TECHNICIAN_SKILLS_UPDATED: ['serviceIds'],
  SERVICE_CREATED: ['basePriceMinor', 'currency'],
  SERVICE_UPDATED: [
    'updatedFields',
    'previousBasePriceMinor',
    'basePriceMinor',
  ],
  SERVICE_DELETED: [],
  REQUEST_CREATED: ['serviceId', 'status', 'version'],
  REQUEST_UPDATED: ['updatedFields', 'previousVersion', 'version'],
  REQUEST_REVIEWED: ['fromStatus', 'toStatus', 'previousVersion', 'version'],
  REQUEST_CANCELLED: ['fromStatus', 'toStatus', 'previousVersion', 'version'],
  WORK_ORDER_ASSIGNED: [
    'requestId',
    'technicianId',
    'start',
    'end',
    'agreedPriceMinor',
    'currency',
    'version',
  ],
  WORK_ORDER_RESCHEDULED: [
    'previousTechnicianId',
    'technicianId',
    'previousStart',
    'previousEnd',
    'start',
    'end',
    'previousVersion',
    'version',
  ],
  WORK_ORDER_STATUS_CHANGED: [
    'fromStatus',
    'toStatus',
    'previousVersion',
    'version',
  ],
  WORK_ORDER_CANCELLED: [
    'requestId',
    'fromStatus',
    'toStatus',
    'previousVersion',
    'version',
  ],
  WORK_ORDER_COMPLETED: [
    'fromStatus',
    'toStatus',
    'previousVersion',
    'version',
    'invoiceId',
  ],
  INVOICE_ISSUED: ['workOrderId', 'amountMinor', 'currency', 'status'],
  INVOICE_PAID: ['paymentId', 'amountMinor', 'currency'],
  PAYMENT_INITIATED: ['invoiceId', 'amountMinor', 'currency', 'status'],
  PAYMENT_STATE_CHANGED: ['invoiceId', 'fromStatus', 'toStatus'],
  PAYMENT_SETTLED: ['invoiceId', 'receiptId', 'amountMinor', 'currency'],
  PAYMENT_RECEIPT_REVIEW: ['invoiceId', 'receiptId', 'reason'],
  FEEDBACK_SUBMITTED: ['feedbackId', 'rating'],
} satisfies Record<AuditEvent['action'], readonly string[]>;

// Unknown actions and fields fail closed; nested payloads are never exposed.
export function auditMetadata(action: string, value: Prisma.JsonValue) {
  if (
    !Object.hasOwn(allowedFields, action) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return {};
  const keys: readonly string[] =
    allowedFields[action as keyof typeof allowedFields];
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        keys.includes(key) &&
        (typeof item === 'number' ||
          typeof item === 'boolean' ||
          (typeof item === 'string' && item.length <= 100) ||
          (Array.isArray(item) &&
            item.length <= 100 &&
            item.every(
              (entry) => typeof entry === 'string' && entry.length <= 100,
            ))),
    ),
  );
}
