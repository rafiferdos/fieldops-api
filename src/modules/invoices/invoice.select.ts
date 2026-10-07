import type { Prisma } from '../../generated/prisma/client.js';

export const invoiceSelect = {
  id: true,
  workOrderId: true,
  customerId: true,
  amountMinor: true,
  currency: true,
  status: true,
  issuedAt: true,
  paidAt: true,
} satisfies Prisma.InvoiceSelect;

export function invoiceView(
  invoice: Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>,
) {
  return {
    ...invoice,
    issuedAt: invoice.issuedAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
  };
}
