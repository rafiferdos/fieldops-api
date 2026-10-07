import { BadGatewayException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { PaymentSettlementService } from '../src/modules/payments/payment-settlement.service.js';
import { closeRequestContext } from './helpers/requests.js';
import {
  createCheckout,
  createPaymentContext,
  notify,
  providerEvidence,
  verifiedCharge,
  type PaymentContext,
} from './helpers/payments.js';

describe('Verified payment settlement', () => {
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
  const bill = () =>
    ctx.prisma.invoice.findUniqueOrThrow({ where: { id: ctx.invoiceId } });
  const row = () =>
    ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  it('settles through server verification while ignoring callback claims', async () => {
    const charge = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [charge]);
    const response = await notify(ctx, 'success', payment.merchantTranId, {
      val_id: charge.val_id,
      status: 'FAILED',
      amount: '1.00',
      risk_level: '1',
      store_id: 'foreign',
      card_no: 'secret-card',
    }).expect(200);
    expect(response.body.data).toEqual({ received: true });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await row()).toMatchObject({
      status: 'SUCCEEDED',
      providerTranId: charge.bank_tran_id,
    });
    expect(await bill()).toMatchObject({ status: 'PAID' });
    expect((await bill()).paidAt).toEqual((await row()).settledAt);
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id, disposition: 'SETTLED' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: ctx.invoiceId, action: 'INVOICE_PAID' },
      }),
    ).toBe(1);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { entityId: payment.id },
    });
    expect(JSON.stringify(audit)).not.toMatch(
      /secret-card|bank_tran_id|fixture-password|val_id/,
    );
  });
  it('makes duplicate concurrent IPN/success and late negative callbacks idempotent', async () => {
    const charge = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [charge]);
    await Promise.all(
      ['ipn', 'success', 'success'].map((kind) =>
        notify(ctx, kind, payment.merchantTranId, {
          val_id: charge.val_id,
        }).expect(200),
      ),
    );
    const original = await row();
    const originalBill = await bill();
    providerEvidence(ctx, [], 'FAILED');
    await notify(ctx, 'fail', payment.merchantTranId, {
      status: 'FAILED',
    }).expect(200);
    await notify(ctx, 'cancel', payment.merchantTranId, {
      status: 'CANCEL',
    }).expect(200);
    expect(await row()).toEqual(original);
    expect(await bill()).toEqual(originalBill);
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: payment.id, action: 'PAYMENT_SETTLED' },
      }),
    ).toBe(1);
    await createCheckout(ctx, randomUUID()).expect(409);
  });
  it.each([
    [{ risk_level: '1' }, 'HIGH_RISK'],
    [{ amount: '1499.99' }, 'AMOUNT_MISMATCH'],
    [{ currency_amount: '1499.99' }, 'AMOUNT_MISMATCH'],
    [{ currency: 'USD' }, 'CURRENCY_MISMATCH'],
    [{ currency_type: 'USD' }, 'CURRENCY_MISMATCH'],
  ] as const)(
    'retains risky/mismatched evidence for review %j',
    async (changes, reason) => {
      const charge = verifiedCharge(payment.merchantTranId, changes);
      providerEvidence(ctx, [charge]);
      await notify(ctx, 'ipn', payment.merchantTranId, {
        val_id: charge.val_id,
      }).expect(200);
      expect(await row()).toMatchObject({
        status: 'REVIEW',
        reviewReason: reason,
      });
      expect((await bill()).status).toBe('UNPAID');
      expect(
        await ctx.prisma.paymentReceipt.findFirstOrThrow({
          where: { paymentId: payment.id },
        }),
      ).toMatchObject({ disposition: 'REVIEW', reviewReason: reason });
      await createCheckout(ctx, randomUUID()).expect(409);
      const before = await row();
      await notify(ctx, 'success', payment.merchantTranId, {
        val_id: charge.val_id,
      }).expect(200);
      expect(await row()).toEqual(before);
      expect(
        await ctx.prisma.paymentReceipt.count({
          where: { paymentId: payment.id },
        }),
      ).toBe(1);
    },
  );
  it('rolls back invoice, payment, receipt and audits on audit failure', async () => {
    const charge = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [charge]);
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation((tx, event) => {
      if (event.action === 'INVOICE_PAID')
        throw new Error('Settlement audit unavailable');
      return original(tx, event);
    });
    await notify(ctx, 'success', payment.merchantTranId, {
      val_id: charge.val_id,
    }).expect(500);
    expect((await row()).status).toBe('PENDING');
    expect((await bill()).status).toBe('UNPAID');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: payment.id, action: 'PAYMENT_SETTLED' },
      }),
    ).toBe(0);
    spy.mockRestore();
    await notify(ctx, 'ipn', payment.merchantTranId, {
      val_id: charge.val_id,
    }).expect(200);
    expect((await bill()).status).toBe('PAID');
  });
  it('never trusts a forged validation ID or a verified foreign transaction', async () => {
    providerEvidence(ctx, []);
    await notify(ctx, 'success', payment.merchantTranId, {
      val_id: 'forged',
    }).expect(502);
    const foreign = verifiedCharge('f'.repeat(24));
    providerEvidence(ctx, [foreign]);
    await notify(ctx, 'ipn', payment.merchantTranId, {
      val_id: foreign.val_id,
    }).expect(502);
    expect((await bill()).status).toBe('UNPAID');
    expect((await row()).status).toBe('PENDING');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
  });
  it('preserves unresolved states when verification is unavailable', async () => {
    ctx.json.mockRejectedValue(
      new BadGatewayException('Verification unavailable'),
    );
    await notify(ctx, 'ipn', payment.merchantTranId, { val_id: 'v' }).expect(
      502,
    );
    expect((await row()).status).toBe('PENDING');
    expect((await bill()).status).toBe('UNPAID');
  });
  it.each(['fail', 'cancel'])(
    'does not close checkout from an unverified %s callback',
    async (kind) => {
      providerEvidence(ctx, []);
      await notify(ctx, kind, payment.merchantTranId, {
        status: kind.toUpperCase(),
      }).expect(200);
      expect((await row()).status).toBe('PENDING');
      await createCheckout(ctx, randomUUID()).expect(409);
    },
  );
  it.each([
    ['fail', 'FAILED', 'FAILED'],
    ['cancel', 'CANCEL', 'CANCELLED'],
  ] as const)(
    'closes only a verified terminal session %s',
    async (kind, providerStatus, status) => {
      providerEvidence(ctx, [], providerStatus);
      await notify(ctx, kind, payment.merchantTranId).expect(200);
      expect((await row()).status).toBe(status);
      expect((await bill()).status).toBe('UNPAID');
      await createCheckout(ctx, randomUUID()).expect(201);
    },
  );
  it('settles a late valid charge after verified failure and flags a second payment capture', async () => {
    providerEvidence(ctx, [], 'FAILED');
    await notify(ctx, 'fail', payment.merchantTranId).expect(200);
    const second = (await createCheckout(ctx, randomUUID()).expect(201)).body
      .data;
    const secondRow = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: second.id },
    });
    const firstCharge = verifiedCharge(payment.merchantTranId);
    const secondCharge = verifiedCharge(secondRow.merchantTranId);
    providerEvidence(ctx, [firstCharge, secondCharge]);
    await Promise.all([
      notify(ctx, 'success', payment.merchantTranId, {
        val_id: firstCharge.val_id,
      }).expect(200),
      notify(ctx, 'ipn', secondRow.merchantTranId, {
        val_id: secondCharge.val_id,
      }).expect(200),
    ]);
    const rows = await ctx.prisma.payment.findMany({
      where: { invoiceId: ctx.invoiceId },
    });
    expect(rows.map((r) => r.status).sort()).toEqual(['REVIEW', 'SUCCEEDED']);
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { payment: { invoiceId: ctx.invoiceId }, disposition: 'REVIEW' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: ctx.invoiceId, action: 'INVOICE_PAID' },
      }),
    ).toBe(1);
  });
  it('records another bank capture on an already settled checkout without counting revenue twice', async () => {
    const first = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [first]);
    await notify(ctx, 'success', payment.merchantTranId, {
      val_id: first.val_id,
    }).expect(200);
    const original = await row();
    const second = verifiedCharge(payment.merchantTranId);
    providerEvidence(ctx, [first, second]);
    await notify(ctx, 'ipn', payment.merchantTranId, {
      val_id: second.val_id,
    }).expect(200);
    expect(await row()).toEqual(original);
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(2);
    const detail = await request(ctx.app.getHttpServer())
      .get(`/api/v1/payments/${payment.id}`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      status: 'SUCCEEDED',
      requiresReview: true,
      checkoutUrl: null,
    });
    await notify(ctx, 'ipn', payment.merchantTranId, {
      val_id: second.val_id,
    }).expect(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: payment.id, action: 'PAYMENT_RECEIPT_REVIEW' },
      }),
    ).toBe(1);
  });
  it('rejects contradictory evidence for the same provider transaction before writing money facts', async () => {
    const first = verifiedCharge(payment.merchantTranId);
    const contradictory = {
      ...first,
      val_id: 'different-validation',
      amount: '1.00',
    };
    providerEvidence(ctx, [first, contradictory]);
    await expect(
      ctx.app.get(PaymentSettlementService).reconcile(payment.id),
    ).rejects.toMatchObject({ status: 502 });
    expect((await bill()).status).toBe('UNPAID');
    expect((await row()).status).toBe('PENDING');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id },
      }),
    ).toBe(0);
  });
  it('holds multiple captures from reconciliation for review', async () => {
    providerEvidence(ctx, [
      verifiedCharge(payment.merchantTranId),
      verifiedCharge(payment.merchantTranId),
    ]);
    const result = await ctx.app
      .get(PaymentSettlementService)
      .reconcile(payment.id);
    expect(result).toMatchObject({ status: 'REVIEW', requiresReview: true });
    expect((await bill()).status).toBe('UNPAID');
    expect(
      await ctx.prisma.paymentReceipt.count({
        where: { paymentId: payment.id, disposition: 'REVIEW' },
      }),
    ).toBe(2);
  });
  it('does not reuse a provider transaction for a different invoice', async () => {
    const other = await createPaymentContext();
    try {
      await createCheckout(other, randomUUID()).expect(201);
      const otherPayment = await other.prisma.payment.findFirstOrThrow({
        where: { invoiceId: other.invoiceId },
      });
      const first = verifiedCharge(payment.merchantTranId);
      const reused = {
        ...verifiedCharge(otherPayment.merchantTranId),
        bank_tran_id: first.bank_tran_id,
      };
      providerEvidence(ctx, [first]);
      providerEvidence(other, [reused]);
      await notify(ctx, 'success', payment.merchantTranId, {
        val_id: first.val_id,
      }).expect(200);
      await notify(other, 'success', otherPayment.merchantTranId, {
        val_id: reused.val_id,
      }).expect(200);
      expect(
        await other.prisma.invoice.findUniqueOrThrow({
          where: { id: other.invoiceId },
        }),
      ).toMatchObject({ status: 'UNPAID' });
      expect(
        await other.prisma.payment.findUniqueOrThrow({
          where: { id: otherPayment.id },
        }),
      ).toMatchObject({ status: 'REVIEW', reviewReason: 'PROVIDER_REUSED' });
    } finally {
      await closeRequestContext(other);
    }
  });
  it('validates callback formats/identifiers and acknowledges without exposing financial details', async () => {
    for (const kind of ['success', 'ipn', 'fail', 'cancel']) {
      await notify(ctx, kind, 'invalid').expect(400);
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/payments/sslcommerz/${kind}`)
        .type('text')
        .send('invalid')
        .expect(415);
    }
    await notify(ctx, 'success', 'b'.repeat(24)).expect(404);
    await request(ctx.app.getHttpServer())
      .post('/api/v1/payments/sslcommerz/ipn')
      .type('form')
      .send({ tran_id: [payment.merchantTranId, payment.merchantTranId] })
      .expect(400);
    expect(ctx.json).toHaveBeenCalledTimes(1); // Initial checkout only.
  });
});
