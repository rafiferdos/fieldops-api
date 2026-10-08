import request from 'supertest';
import {
  createFeedbackContext,
  payFeedbackInvoice,
  type FeedbackContext,
} from './helpers/feedback.js';
import { closeRequestContext } from './helpers/requests.js';
import { notify } from './helpers/payments.js';

describe('Administration overview (e2e)', () => {
  let ctx: FeedbackContext;
  let from: string;
  beforeEach(async () => {
    from = new Date().toISOString();
    ctx = await createFeedbackContext();
  });
  afterEach(async () => closeRequestContext(ctx));
  const overview = (query = '', token = ctx.admin.token) =>
    request(ctx.app.getHttpServer())
      .get('/api/v1/admin/overview' + query)
      .set('Authorization', `Bearer ${token}`);

  it('reports a consistent bounded cohort and only verified paid invoice revenue', async () => {
    const to = new Date(Date.now() + 60000).toISOString();
    const query = `?from=${from}&to=${to}`;
    const before = (await overview(query).expect(200)).body.data;
    expect(before.workOrders).toEqual({
      total: 1,
      completed: 1,
      completionRate: 100,
    });
    expect(before.requests.total).toBe(1);
    const payment = await payFeedbackInvoice(ctx);
    const after = (await overview(query).expect(200)).body.data;
    expect(after.invoices.paidCount).toBe(before.invoices.paidCount + 1);
    expect(
      BigInt(after.invoices.verifiedRevenueMinor) -
        BigInt(before.invoices.verifiedRevenueMinor),
    ).toBe(150000n);
    expect(after.invoices.currency).toBe('BDT');
    const receipt = await ctx.prisma.paymentReceipt.findFirstOrThrow({
      where: { paymentId: payment.id },
    });
    await notify(ctx, 'ipn', payment.merchantTranId, {
      val_id: receipt.validationId,
    }).expect(200);
    expect((await overview(query).expect(200)).body.data.invoices).toEqual(
      after.invoices,
    );
  });

  it('handles empty periods and rejects forbidden or unbounded queries', async () => {
    const empty = (
      await overview(
        '?from=2000-01-01T00:00:00Z&to=2000-01-02T00:00:00Z',
      ).expect(200)
    ).body.data;
    expect(empty.workOrders).toEqual({
      total: 0,
      completed: 0,
      completionRate: 0,
    });
    expect(empty.invoices).toEqual({
      paidCount: 0,
      verifiedRevenueMinor: '0',
      currency: 'BDT',
    });
    await overview('', ctx.owner.token).expect(403);
    await overview('', ctx.technician.token).expect(403);
    for (const query of [
      '?from=invalid',
      '?from=2026-01-01T00:00:00Z',
      '?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z',
      '?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z',
      '?limit=10',
    ])
      await overview(query).expect(400);
  });
});
