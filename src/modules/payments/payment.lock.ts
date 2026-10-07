import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
export async function lockInvoice(
  tx: Prisma.TransactionClient,
  id: string,
  customerId?: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      customerId: string;
      amountMinor: number;
      currency: 'BDT';
      status: 'UNPAID' | 'PAID';
    }>
  >`
    SELECT "id", "customerId", "amountMinor", "currency", "status" FROM "Invoice"
    WHERE "id" = ${id}::uuid AND (${customerId ?? null}::uuid IS NULL OR "customerId" = ${customerId ?? null}::uuid) FOR UPDATE`;
  if (!rows[0]) throw new NotFoundException('Invoice not found');
  return rows[0];
}
export async function lockPayment(tx: Prisma.TransactionClient, id: string) {
  // Always lock the invoice first; all payment writers use this order.
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return tx.payment.findUniqueOrThrow({ where: { id } });
}
