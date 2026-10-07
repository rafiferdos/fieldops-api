import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import { runningOrder } from './helpers/completion.js';

describe('Private invoice reads (e2e)', () => {
  let ctx: RequestContext;
  let id: string;
  let requestId: string;
  beforeEach(async () => {
    ctx = await createRequestContext();
    const order = await runningOrder(ctx);
    requestId = order.requestId;
    const result = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({
        version: order.version,
        report: 'Inspection and repair completed.',
      })
      .expect(200);
    id = result.body.data.invoice.id;
  });
  afterEach(() => closeRequestContext(ctx));
  const read = (token = ctx.owner.token, invoiceId = id) =>
    request(ctx.app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);
  it('returns exactly the immutable safe invoice fields for customer owner and admin', async () => {
    for (const user of [ctx.owner, ctx.admin]) {
      const result = await read(user.token).expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(Object.keys(result.body.data).sort()).toEqual(
        [
          'id',
          'workOrderId',
          'customerId',
          'amountMinor',
          'currency',
          'status',
          'issuedAt',
          'paidAt',
        ].sort(),
      );
      expect(result.body.data).toMatchObject({
        id,
        customerId: ctx.owner.id,
        amountMinor: 150000,
        currency: 'BDT',
        status: 'UNPAID',
        paidAt: null,
      });
      expect(JSON.stringify(result.body)).not.toMatch(
        /passwordHash|accessToken|refreshToken|sessionKey|checkoutUrl/,
      );
    }
    await read(ctx.owner.token, id.toUpperCase()).expect(200);
  });
  it('hides foreign invoices and denies technician finance access', async () => {
    await read(ctx.other.token).expect(404);
    await read(ctx.technician.token).expect(403);
    await read(ctx.owner.token, randomUUID()).expect(404);
    await read(ctx.owner.token, 'invalid').expect(400);
    const noAuth = await request(ctx.app.getHttpServer())
      .get(`/api/v1/invoices/${id}`)
      .expect(401);
    expect(noAuth.headers['cache-control']).toBe('no-store');
  });
  it('keeps owned financial history readable after catalog and request soft deletion', async () => {
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { deletedAt: new Date(), basePriceMinor: 990000 },
    });
    await ctx.prisma.serviceRequest.update({
      where: { id: requestId },
      data: { deletedAt: new Date() },
    });
    expect((await read().expect(200)).body.data.amountMinor).toBe(150000);
  });
  it('checks current role, suspension and revoked sessions rather than JWT-era state', async () => {
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { role: 'TECHNICIAN' },
    });
    await read().expect(403);
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { role: 'CUSTOMER', status: 'SUSPENDED' },
    });
    await read().expect(401);
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { status: 'ACTIVE' },
    });
    await ctx.prisma.session.updateMany({
      where: { userId: ctx.owner.id },
      data: { revokedAt: new Date() },
    });
    await read().expect(401);
  });
  it('offers no client endpoint for changing amount or setting paid status', async () => {
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/invoices/${id}`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ status: 'PAID', amountMinor: 1 })
      .expect(404);
    expect((await read().expect(200)).body.data.status).toBe('UNPAID');
  });
});
