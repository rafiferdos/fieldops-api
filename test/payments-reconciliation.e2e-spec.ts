import { BadGatewayException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentSettlementService } from '../src/modules/payments/payment-settlement.service.js';
import { closeRequestContext } from './helpers/requests.js';
import {
  billing,
  createCheckout,
  createPaymentContext,
  notify,
  providerEvidence,
  verifiedCharge,
  type PaymentContext,
} from './helpers/payments.js';

describe('Payment recovery and early callback races', () => {
  let ctx: PaymentContext;
  beforeEach(async () => {
    ctx = await createPaymentContext();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const ageAttempt = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16000);
  };
  it('recovers an uncertain attempt by merchant lookup without another initiation', async () => {
    ctx.json.mockRejectedValueOnce(new BadGatewayException('Timed out'));
    const key = randomUUID();
    await createCheckout(ctx, key).expect(502);
    const row = await ctx.prisma.payment.findFirstOrThrow({
      where: { invoiceId: ctx.invoiceId },
    });
    providerEvidence(ctx, [verifiedCharge(row.merchantTranId)]);
    ageAttempt();
    const replay = await createCheckout(ctx, key).expect(200);
    expect(replay.body.data).toMatchObject({
      id: row.id,
      status: 'SUCCEEDED',
      checkoutUrl: null,
    });
    expect(ctx.json.mock.calls.filter(([, form]) => form)).toHaveLength(1);
    expect(
      (
        await ctx.prisma.invoice.findUniqueOrThrow({
          where: { id: ctx.invoiceId },
        })
      ).status,
    ).toBe('PAID');
  });
  it('keeps a crashed reservation unresolved when the gateway has no record', async () => {
    const identity = ctx.gateway.identity();
    const row = await ctx.prisma.payment.create({
      data: {
        invoiceId: ctx.invoiceId,
        userId: ctx.owner.id,
        ...identity,
        merchantTranId: 'd'.repeat(24),
        amountMinor: 150000,
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
      },
    });
    providerEvidence(ctx, []);
    const result = await ctx.app
      .get(PaymentSettlementService)
      .reconcile(row.id);
    expect(result).toMatchObject({
      id: row.id,
      status: 'INITIATING',
      checkoutUrl: null,
    });
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json.mock.calls.filter(([, form]) => form)).toHaveLength(0);
  });
  it('keeps a pending checkout active when reconciliation finds no payment', async () => {
    const key = randomUUID();
    const first = await createCheckout(ctx, key).expect(201);
    providerEvidence(ctx, []);
    ageAttempt();
    const replay = await createCheckout(ctx, key).expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json.mock.calls.filter(([, form]) => form)).toHaveLength(1);
  });
  it('does not initiate a replacement when lookup is unavailable', async () => {
    const key = randomUUID();
    await createCheckout(ctx, key).expect(201);
    ageAttempt();
    ctx.json.mockRejectedValue(new BadGatewayException('Unavailable'));
    await createCheckout(ctx, key).expect(502);
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(
      (
        await ctx.prisma.payment.findFirstOrThrow({
          where: { invoiceId: ctx.invoiceId },
        })
      ).status,
    ).toBe('PENDING');
  });
  it.each(['ready', 'timeout'] as const)(
    'lets an early verified callback win over a later %s initiation outcome',
    async (outcome) => {
      ctx.json.mockImplementation(async (url, form) => {
        if (form) {
          const merchantTranId = form.get('tran_id')!;
          const charge = verifiedCharge(merchantTranId);
          const initial = ctx.json.getMockImplementation()!;
          providerEvidence(ctx, [charge]);
          await notify(ctx, 'ipn', merchantTranId, {
            val_id: charge.val_id,
          }).expect(200);
          ctx.json.mockImplementation(initial);
          if (outcome === 'timeout')
            throw new BadGatewayException('Timed out after provider capture');
          return {
            status: 'SUCCESS',
            sessionkey: 'early-session',
            GatewayPageURL:
              'https://sandbox.sslcommerz.com/pay?s=early-session',
          };
        }
        throw new Error(`Unexpected transport request: ${url.pathname}`);
      });
      const result = await createCheckout(ctx, randomUUID()).expect(201);
      expect(result.body.data).toMatchObject({
        status: 'SUCCEEDED',
        checkoutUrl: null,
      });
      expect(
        await ctx.prisma.paymentReceipt.count({
          where: { paymentId: result.body.data.id },
        }),
      ).toBe(1);
    },
  );
  it('rechecks revoked sessions after provider reconciliation without losing the financial result', async () => {
    const key = randomUUID();
    await createCheckout(ctx, key).expect(201);
    const row = await ctx.prisma.payment.findFirstOrThrow({
      where: { invoiceId: ctx.invoiceId },
    });
    const charge = verifiedCharge(row.merchantTranId);
    providerEvidence(ctx, [charge]);
    ageAttempt();
    const transport = ctx.json.getMockImplementation()!;
    ctx.json.mockImplementation(async (url, form, signal) => {
      const value = await transport(url, form, signal);
      if (url.searchParams.has('val_id'))
        await ctx.prisma.session.update({
          where: { id: ctx.owner.actor.sessionId },
          data: { revokedAt: new Date() },
        });
      return value;
    });
    await createCheckout(ctx, key, billing).expect(401);
    expect(
      (
        await ctx.prisma.invoice.findUniqueOrThrow({
          where: { id: ctx.invoiceId },
        })
      ).status,
    ).toBe('PAID');
  });
});
