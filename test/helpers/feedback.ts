import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createCheckout,
  createPaymentContext,
  notify,
  providerEvidence,
  verifiedCharge,
} from './payments.js';

export async function createFeedbackContext() {
  const ctx = await createPaymentContext();
  const invoice = await ctx.prisma.invoice.findUniqueOrThrow({
    where: { id: ctx.invoiceId },
  });
  return { ...ctx, workOrderId: invoice.workOrderId };
}
export type FeedbackContext = Awaited<ReturnType<typeof createFeedbackContext>>;

// Only gateway transport is simulated; checkout, validation, settlement and HTTP authorization are real.
export async function payFeedbackInvoice(ctx: FeedbackContext, risky = false) {
  await createCheckout(ctx, randomUUID()).expect(201);
  const payment = await ctx.prisma.payment.findFirstOrThrow({
    where: { invoiceId: ctx.invoiceId },
  });
  const charge = verifiedCharge(payment.merchantTranId, {
    risk_level: risky ? '1' : '0',
  });
  providerEvidence(ctx, [charge]);
  await notify(ctx, 'ipn', payment.merchantTranId, {
    val_id: charge.val_id,
  }).expect(200);
  return payment;
}

export function submitFeedback(
  ctx: FeedbackContext,
  input: object = { rating: 5, comment: 'Excellent service.' },
  token = ctx.owner.token,
  workOrderId = ctx.workOrderId,
) {
  return request(ctx.app.getHttpServer())
    .post(`/api/v1/work-orders/${workOrderId}/feedback`)
    .set('Authorization', `Bearer ${token}`)
    .send(input);
}
