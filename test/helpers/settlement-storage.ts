import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { RequestContext } from './requests.js';

// Test-only storage fixture. This does not claim a real provider charge; gateway flows have separate HTTP tests.
export async function settleStorageFixture(
  ctx: RequestContext,
  invoiceId: string,
  paidAt: Date,
) {
  return ctx.prisma.$transaction(async (tx) => {
    const bill = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        userId: bill.customerId,
        amountMinor: bill.amountMinor,
        gatewayMode: 'SANDBOX',
        gatewayStoreId: 'fixture-store',
        merchantTranId: randomBytes(12).toString('hex'),
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        createdAt: paidAt,
      },
    });
    await completeStorageSettlement(tx, payment, paidAt);
  });
}
export async function completeStorageSettlement(
  tx: Prisma.TransactionClient,
  payment: { id: string; invoiceId: string; amountMinor: number },
  paidAt: Date,
) {
  const providerTranId = `bank-${randomUUID()}`;
  await tx.paymentReceipt.create({
    data: {
      paymentId: payment.id,
      providerTranId,
      validationId: randomUUID(),
      amountMinor: payment.amountMinor,
      currency: 'BDT',
      originalAmountMinor: payment.amountMinor,
      originalCurrency: 'BDT',
      risky: false,
      disposition: 'SETTLED',
    },
  });
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SUCCEEDED',
      providerTranId,
      verifiedAt: paidAt,
      settledAt: paidAt,
    },
  });
  await tx.invoice.update({
    where: { id: payment.invoiceId },
    data: { status: 'PAID', paidAt },
  });
}
