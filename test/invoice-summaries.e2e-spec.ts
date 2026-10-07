import { settleStorageFixture } from './helpers/settlement-storage.js';
import request from 'supertest';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import { runningOrder } from './helpers/completion.js';

describe('Linked safe invoice views (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => closeRequestContext(ctx));
  it('uses the same safe invoice contract in completion, work lists/details and request summaries', async () => {
    const order = await runningOrder(ctx);
    const before = await request(ctx.app.getHttpServer())
      .get(`/api/v1/work-orders/${order.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);
    expect(before.body.data.invoice).toBeNull();
    const completed = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({
        version: order.version,
        report: 'Inspection and repair completed.',
      })
      .expect(200);
    const invoice = completed.body.data.invoice;
    const finance = await request(ctx.app.getHttpServer())
      .get(`/api/v1/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);
    expect(finance.body.data).toEqual(invoice);
    for (const user of [ctx.owner, ctx.technician, ctx.admin]) {
      const detail = await request(ctx.app.getHttpServer())
        .get(`/api/v1/work-orders/${order.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(detail.body.data.invoice).toEqual(invoice);
      expect(
        detail.body.data.timeline.some(
          (event: { action: string }) =>
            event.action === 'WORK_ORDER_COMPLETED',
        ),
      ).toBe(true);
      const list = await request(ctx.app.getHttpServer())
        .get('/api/v1/work-orders')
        .query({ serviceId: ctx.service.id, status: 'COMPLETED' })
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(list.body.data.items[0].invoice).toEqual(invoice);
    }
    const customerRequest = await request(ctx.app.getHttpServer())
      .get(`/api/v1/requests/${order.requestId}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);
    expect(customerRequest.body.data.workOrder.invoice).toEqual(invoice);
    const foreign = await request(ctx.app.getHttpServer())
      .get('/api/v1/work-orders')
      .query({ serviceId: ctx.service.id })
      .set('Authorization', `Bearer ${ctx.other.token}`)
      .expect(200);
    expect(foreign.body.data.items).toEqual([]);
    expect(JSON.stringify(completed.body)).not.toMatch(
      /passwordHash|accessToken|sessionKey|checkoutUrl|providerTranId/,
    );
  });
  it('reads current invoice settlement facts from PostgreSQL rather than caching stale UNPAID state', async () => {
    const order = await runningOrder(ctx);
    const result = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({
        version: order.version,
        report: 'Inspection and repair completed.',
      })
      .expect(200);
    const id = result.body.data.invoice.id;
    // Test-only complete financial graph; provider verification is exercised in payment tests.
    const paidAt = new Date();
    await settleStorageFixture(ctx, id, paidAt);
    for (const path of [
      `/api/v1/work-orders/${order.id}`,
      `/api/v1/invoices/${id}`,
    ]) {
      const read = await request(ctx.app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      const invoice = path.includes('work-orders')
        ? read.body.data.invoice
        : read.body.data;
      expect(invoice.status).toBe('PAID');
      expect(invoice.paidAt).toBe(paidAt.toISOString());
      expect(read.headers['cache-control']).toBe('no-store');
    }
  });
});
