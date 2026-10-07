import type { Prisma } from '../../generated/prisma/client.js';
export const paymentSelect = {
  id: true,
  invoiceId: true,
  amountMinor: true,
  currency: true,
  status: true,
  gatewayMode: true,
  checkoutUrl: true,
  reviewReason: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
  settledAt: true,
  invoice: { select: { status: true } },
} satisfies Prisma.PaymentSelect;
export function paymentView(
  row: Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>,
) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    gateway: 'SSLCOMMERZ' as const,
    mode: row.gatewayMode,
    status: row.status,
    checkoutUrl:
      row.status === 'PENDING' && row.invoice.status === 'UNPAID'
        ? row.checkoutUrl
        : null,
    reviewReason: row.reviewReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}
