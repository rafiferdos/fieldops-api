import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRequestContext } from './helpers/requests.js';
import {
  createCheckout,
  createPaymentContext,
  notify,
  providerEvidence,
  verifiedCharge,
  type PaymentContext,
} from './helpers/payments.js';

// Real Nest/database boundaries; only provider HTTP is replaced in this suite.
describe('Provider browser return transport', () => {
  let ctx: PaymentContext;
  let payment: Awaited<
    ReturnType<PaymentContext['prisma']['payment']['findFirstOrThrow']>
  >;
  beforeEach(async () => {
    ctx = await createPaymentContext();
    await createCheckout(ctx, randomUUID()).expect(201);
    payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { invoiceId: ctx.invoiceId },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const attempt = () =>
    ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const invoice = () =>
    ctx.prisma.invoice.findUniqueOrThrow({ where: { id: ctx.invoiceId } });

  it('settles before issuing a no-store 303 to the configured frontend and ignores supplied destinations', async () => {
    const charge = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [charge]);
    const response = await notify(
      ctx,
      'return/success',
      payment.merchantTranId,
      {
        val_id: charge.val_id,
        paymentId: randomUUID(),
        returnTo: 'https://evil.example',
        status: 'FAILED',
      },
    ).expect(303);
    expect(response.headers.location).toBe(
      `http://localhost:3001/payment/success?paymentId=${payment.id}`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect((await attempt()).status).toBe('SUCCEEDED');
    expect((await invoice()).status).toBe('PAID');
  });

  it.each([
    ['cancel', 'CANCEL', 'CANCELLED'],
    ['fail', 'FAILED', 'FAILED'],
  ])(
    'returns a verified %s to the inspection page and permits only an explicit new key',
    async (kind, terminal, status) => {
      providerEvidence(ctx, [], terminal);
      const response = await notify(
        ctx,
        `return/${kind}`,
        payment.merchantTranId,
      ).expect(303);
      expect(response.headers.location).toBe(
        `http://localhost:3001/payment/cancel?paymentId=${payment.id}`,
      );
      expect((await attempt()).status).toBe(status);
      expect((await invoice()).status).toBe('UNPAID');
      const next = await createCheckout(ctx, randomUUID()).expect(201);
      expect(next.body.data.id).not.toBe(payment.id);
    },
  );

  it('returns for inspection without trusting unverified cancellation or releasing its attempt', async () => {
    providerEvidence(ctx, []);
    await notify(ctx, 'return/cancel', payment.merchantTranId, {
      status: 'CANCEL',
    }).expect(303);
    expect((await attempt()).status).toBe('PENDING');
    expect((await invoice()).status).toBe('UNPAID');
    await createCheckout(ctx, randomUUID()).expect(409);
  });

  it('returns a known attempt after provider failure without writing financial success', async () => {
    ctx.json.mockRejectedValue(new Error('Provider transport unavailable'));
    const response = await notify(
      ctx,
      'return/success',
      payment.merchantTranId,
      { val_id: 'unverified' },
    ).expect(303);
    expect(response.headers.location).toBe(
      `http://localhost:3001/payment/success?paymentId=${payment.id}`,
    );
    expect((await attempt()).status).toBe('PENDING');
    expect((await invoice()).status).toBe('UNPAID');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
    await createCheckout(ctx, randomUUID()).expect(409);
  });

  it('cannot reverse success or duplicate settlement when IPN and browser returns race', async () => {
    const charge = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [charge]);
    await Promise.all([
      notify(ctx, 'ipn', payment.merchantTranId, {
        val_id: charge.val_id,
      }).expect(200),
      notify(ctx, 'return/success', payment.merchantTranId, {
        val_id: charge.val_id,
      }).expect(303),
    ]);
    const original = await attempt();
    providerEvidence(ctx, [], 'CANCEL');
    await notify(ctx, 'return/cancel', payment.merchantTranId).expect(303);
    expect(await attempt()).toEqual(original);
    expect((await invoice()).status).toBe('PAID');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(1);
    await createCheckout(ctx, randomUUID()).expect(409);
  });

  it('rejects unknown/malformed attempts, invalid kinds and unsupported payloads without redirecting', async () => {
    await notify(ctx, 'return/success', 'b'.repeat(24)).expect(404);
    await notify(ctx, 'return/success', 'invalid').expect(400);
    await notify(ctx, 'return/ipn', payment.merchantTranId).expect(400);
    await request(ctx.app.getHttpServer())
      .post('/api/v1/payments/sslcommerz/return/success')
      .type('text')
      .send('invalid')
      .expect(415);
    expect(ctx.json).toHaveBeenCalledTimes(1);
  });
});
