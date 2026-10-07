import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { closeRequestContext } from './helpers/requests.js';
import {
  billing,
  createCheckout,
  createPaymentContext,
  type PaymentContext,
} from './helpers/payments.js';

describe('Payment initiation and private reads', () => {
  let ctx: PaymentContext;
  beforeEach(async () => {
    ctx = await createPaymentContext();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  it('reserves before the network call and sends the frozen amount', async () => {
    ctx.json.mockImplementation(async (_url, form) => {
      const row = await ctx.prisma.payment.findUniqueOrThrow({
        where: { merchantTranId: form!.get('tran_id')! },
      });
      expect(row.status).toBe('INITIATING');
      expect(form!.get('total_amount')).toBe('1500.00');
      return {
        status: 'SUCCESS',
        sessionkey: 's',
        GatewayPageURL: 'https://sandbox.sslcommerz.com/pay?s=s',
      };
    });
    const result = await createCheckout(ctx, randomUUID()).expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data).toMatchObject({
      invoiceId: ctx.invoiceId,
      status: 'PENDING',
      amountMinor: 150000,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /fixture-password|merchantTranId|requestHash|sessionKey|gatewayStoreId/,
    );
    expect(
      (
        await ctx.prisma.invoice.findUniqueOrThrow({
          where: { id: ctx.invoiceId },
        })
      ).status,
    ).toBe('UNPAID');
  });
  it('replays the same key without another initiation or audit', async () => {
    const key = randomUUID();
    const first = await createCheckout(ctx, key).expect(201);
    const replay = await createCheckout(ctx, key).expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(ctx.json).toHaveBeenCalledTimes(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: first.body.data.id },
      }),
    ).toBe(2);
  });
  it('serializes simultaneous same-key calls into a single network initiation', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      createCheckout(ctx, key),
      createCheckout(ctx, key),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(ctx.json).toHaveBeenCalledTimes(1);
    expect(
      await ctx.prisma.payment.count({ where: { invoiceId: ctx.invoiceId } }),
    ).toBe(1);
  });
  it('rejects key reuse with changed billing and a second live key', async () => {
    const key = randomUUID();
    await createCheckout(ctx, key).expect(201);
    await createCheckout(ctx, key, {
      billing: { ...billing.billing, city: 'Chattogram' },
    }).expect(409);
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json).toHaveBeenCalledTimes(1);
  });
  it('prevents cross-invoice key reuse, including a race', async () => {
    // A second owned frozen invoice, created through the real workflow.
    const { visitWindow } = await import('./helpers/scheduling.js');
    const { approvedRequest, assignRequest } =
      await import('./helpers/scheduling.js');
    const req = await approvedRequest(ctx);
    const window = visitWindow(48);
    const order = await assignRequest(ctx, req.id, window).expect(201);
    for (const [version, status] of [
      [1, 'EN_ROUTE'],
      [2, 'IN_PROGRESS'],
    ] as const)
      await request(ctx.app.getHttpServer())
        .patch(`/api/v1/work-orders/${order.body.data.id}/status`)
        .set('Authorization', `Bearer ${ctx.technician.token}`)
        .send({ version, status })
        .expect(200);
    const complete = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${order.body.data.id}/complete`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({ version: 3, report: 'Completed another inspection and repair.' })
      .expect(200);
    const key = randomUUID();
    const original = ctx.invoiceId;
    const second = {
      ...ctx,
      invoiceId: complete.body.data.invoice.id as string,
    };
    const results = await Promise.all([
      createCheckout(ctx, key),
      createCheckout(second, key),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(ctx.json).toHaveBeenCalledTimes(1);
    expect(ctx.invoiceId).toBe(original);
  });
  it('retains UNKNOWN after transport timeout and blocks a replacement charge', async () => {
    ctx.json.mockRejectedValue(new Error('uncertain network failure'));
    const key = randomUUID();
    await createCheckout(ctx, key).expect(502);
    const replay = await createCheckout(ctx, key).expect(200);
    expect(replay.body.data).toMatchObject({
      status: 'UNKNOWN',
      checkoutUrl: null,
    });
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json).toHaveBeenCalledTimes(1);
  });
  it('retains INITIATING if persistence fails after the provider responds', async () => {
    const audit = ctx.app.get(AuditService);
    const record = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation((tx, event) => {
      if (event.action === 'PAYMENT_STATE_CHANGED')
        throw new Error('Audit unavailable');
      return record(tx, event);
    });
    await createCheckout(ctx, randomUUID()).expect(500);
    spy.mockRestore();
    const row = await ctx.prisma.payment.findFirstOrThrow({
      where: { invoiceId: ctx.invoiceId },
    });
    expect(row.status).toBe('INITIATING');
    await createCheckout(ctx, row.idempotencyKey).expect(200);
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json).toHaveBeenCalledTimes(1);
  });
  it('does not contact the gateway when reservation audit fails', async () => {
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValue(
      new Error('Audit unavailable'),
    );
    await createCheckout(ctx, randomUUID()).expect(500);
    expect(ctx.json).not.toHaveBeenCalled();
    expect(
      await ctx.prisma.payment.count({ where: { invoiceId: ctx.invoiceId } }),
    ).toBe(0);
  });
  it('preserves verified initiation rejection and permits a fresh key', async () => {
    ctx.json.mockResolvedValueOnce({
      status: 'FAILED',
      failedreason: 'fixture-password',
    });
    const key = randomUUID();
    const failed = await createCheckout(ctx, key).expect(502);
    expect(JSON.stringify(failed.body)).not.toContain('fixture-password');
    expect((await createCheckout(ctx, key).expect(200)).body.data.status).toBe(
      'FAILED',
    );
    await createCheckout(ctx, randomUUID()).expect(201);
    expect(ctx.json).toHaveBeenCalledTimes(2);
  });
  it('scopes reads and mutation access using live account/session state', async () => {
    await createCheckout(ctx, randomUUID(), billing, ctx.other.token).expect(
      404,
    );
    for (const token of [ctx.admin.token, ctx.technician.token])
      await createCheckout(ctx, randomUUID(), billing, token).expect(403);
    const row = (await createCheckout(ctx, randomUUID()).expect(201)).body.data;
    for (const token of [ctx.owner.token, ctx.admin.token])
      await request(ctx.app.getHttpServer())
        .get(`/api/v1/payments/${row.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    await request(ctx.app.getHttpServer())
      .get(`/api/v1/payments/${row.id}`)
      .set('Authorization', `Bearer ${ctx.other.token}`)
      .expect(404);
    await request(ctx.app.getHttpServer())
      .get(`/api/v1/payments/${row.id}`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .expect(403);
    await ctx.prisma.session.update({
      where: { id: ctx.owner.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await createCheckout(ctx, randomUUID()).expect(401);
    await expect(
      ctx.app
        .get(PaymentsService)
        .createSession(ctx.owner.actor, ctx.invoiceId, randomUUID(), billing),
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    {},
    { ...billing, amountMinor: 1 },
    { billing: { ...billing.billing, country: 'BD' } },
    { billing: { ...billing.billing, city: '' } },
  ])('rejects invalid billing or client money %j', async (body) => {
    await createCheckout(ctx, randomUUID(), body).expect(400);
    expect(ctx.json).not.toHaveBeenCalled();
  });
  it.each([
    'short',
    'contains space in key',
    'x'.repeat(101),
    'bad,key-that-is-long',
  ])('rejects invalid key %s', async (key) => {
    await createCheckout(ctx, key).expect(400);
    expect(ctx.json).not.toHaveBeenCalled();
  });
  it('requires a key and international profile phone', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/invoices/${ctx.invoiceId}/payment-session`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send(billing)
      .expect(400);
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { phone: null },
    });
    await createCheckout(ctx, randomUUID()).expect(409);
    expect(ctx.json).not.toHaveBeenCalled();
  });
});
describe('Disabled gateway', () => {
  it('returns 503 without reserving a charge', async () => {
    const ctx = await createPaymentContext(true);
    try {
      await createCheckout(ctx, randomUUID()).expect(503);
      expect(
        await ctx.prisma.payment.count({ where: { invoiceId: ctx.invoiceId } }),
      ).toBe(0);
    } finally {
      await closeRequestContext(ctx);
    }
  });
});
