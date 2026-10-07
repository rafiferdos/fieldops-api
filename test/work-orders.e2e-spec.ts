import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import {
  assignedOrder,
  approvedRequest,
  assignRequest,
  visitWindow,
} from './helpers/scheduling.js';

describe('Scoped work orders and progress (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    return closeRequestContext(ctx);
  });
  const detail = (id: string, token: string) =>
    request(ctx.app.getHttpServer())
      .get(`/api/v1/work-orders/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const progress = (
    id: string,
    version: number,
    status: string,
    token = ctx.technician.token,
  ) =>
    request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version, status });
  const cancel = (requestId: string, version: number) =>
    request(ctx.app.getHttpServer())
      .post(`/api/v1/requests/${requestId}/cancel`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ version, reason: 'Plans have changed' });

  it('scopes reads and search to customer ownership and technician assignment, with safe timeline', async () => {
    const order = await assignedOrder(ctx);
    for (const user of [ctx.owner, ctx.technician, ctx.admin]) {
      const read = await detail(order.id, user.token).expect(200);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(read.body.data.timeline).toHaveLength(1);
      expect(read.body.data.timeline[0].action).toBe('WORK_ORDER_ASSIGNED');
      expect(JSON.stringify(read.body)).not.toMatch(
        /passwordHash|accessToken|refreshToken|actorId/,
      );
      const list = await request(ctx.app.getHttpServer())
        .get('/api/v1/work-orders')
        .set('Authorization', `Bearer ${user.token}`)
        .query({
          serviceId: ctx.service.id,
          page: 1,
          limit: 1,
          sort: 'scheduled_start_asc',
          q: 'cooling',
        })
        .expect(200);
      expect(list.body.data.items[0].id).toBe(order.id);
      expect(list.body.data.pagination.total).toBe(1);
    }
    await detail(order.id, ctx.other.token).expect(404);
    const foreign = await request(ctx.app.getHttpServer())
      .get('/api/v1/work-orders')
      .set('Authorization', `Bearer ${ctx.other.token}`)
      .query({ serviceId: ctx.service.id })
      .expect(200);
    expect(foreign.body.data.pagination.total).toBe(0);
    const wildcard = await request(ctx.app.getHttpServer())
      .get('/api/v1/work-orders')
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .query({ serviceId: ctx.service.id, q: '%' })
      .expect(200);
    expect(wildcard.body.data.items).toEqual([]);
    const req = await request(ctx.app.getHttpServer())
      .get(`/api/v1/requests/${order.requestId}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .expect(200);
    expect(req.body.data.workOrder.id).toBe(order.id);
  });
  it('permits only ordered transitions and protects optimistic versions', async () => {
    const order = await assignedOrder(ctx);
    await progress(order.id, 1, 'IN_PROGRESS').expect(409);
    await progress(order.id, 1, 'COMPLETED').expect(400);
    const enRoute = await progress(order.id, 1, 'EN_ROUTE').expect(200);
    expect(enRoute.body.data.version).toBe(2);
    await progress(order.id, 1, 'IN_PROGRESS').expect(409);
    await progress(order.id, 2, 'EN_ROUTE').expect(409);
    const running = await progress(order.id, 2, 'IN_PROGRESS').expect(200);
    expect(running.body.data.version).toBe(3);
    const read = await detail(order.id, ctx.owner.token).expect(200);
    expect(read.body.data.timeline).toHaveLength(3);
    await cancel(order.requestId, order.request.version).expect(409);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${order.id}/schedule`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ version: 3, technicianId: ctx.technician.id, ...visitWindow(30) })
      .expect(409);
  });
  it.each(['owner', 'admin'] as const)(
    'denies %s progress privileges',
    async (role) => {
      const order = await assignedOrder(ctx);
      await progress(order.id, 1, 'EN_ROUTE', ctx[role].token).expect(403);
    },
  );
  it('reassignment removes the old technician access and allows assigning away from a suspended technician', async () => {
    const order = await assignedOrder(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { role: 'TECHNICIAN' },
    });
    await request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${ctx.other.id}/skills`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ serviceIds: [ctx.service.id] })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${order.id}/schedule`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ version: 1, technicianId: ctx.other.id, ...visitWindow() })
      .expect(200);
    await detail(order.id, ctx.technician.token).expect(404);
    await progress(order.id, 2, 'EN_ROUTE').expect(404);
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { status: 'SUSPENDED' },
    });
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${order.id}/schedule`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ version: 2, technicianId: ctx.technician.id, ...visitWindow() })
      .expect(200);
  });
  it('honors session revocation and role/account changes after JWT issuance', async () => {
    const order = await assignedOrder(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { role: 'CUSTOMER' },
    });
    await progress(order.id, 1, 'EN_ROUTE').expect(403);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { role: 'TECHNICIAN', status: 'SUSPENDED' },
    });
    await detail(order.id, ctx.technician.token).expect(401);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'ACTIVE' },
    });
    await ctx.prisma.session.updateMany({
      where: { userId: ctx.technician.id },
      data: { revokedAt: new Date() },
    });
    await progress(order.id, 1, 'EN_ROUTE').expect(401);
  });
  it('cancels request and unstarted work atomically and frees the occupied slot', async () => {
    const dates = visitWindow();
    const order = await assignedOrder(ctx, dates);
    const response = await cancel(
      order.requestId,
      order.request.version,
    ).expect(200);
    expect(response.body.data.status).toBe('CANCELLED');
    expect(response.body.data.workOrder.status).toBe('CANCELLED');
    expect(response.body.data.workOrder.version).toBe(2);
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id, dates).expect(201);
    await progress(order.id, 2, 'EN_ROUTE').expect(409);
  });
  it('cancellation racing against technician start has exactly one winner', async () => {
    const order = await assignedOrder(ctx);
    const results = await Promise.all([
      cancel(order.requestId, order.request.version),
      progress(order.id, 1, 'EN_ROUTE'),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const stored = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { request: true },
    });
    if (stored.status === 'CANCELLED')
      expect(stored.request.status).toBe('CANCELLED');
    else {
      expect(stored.status).toBe('EN_ROUTE');
      expect(stored.request.status).toBe('APPROVED');
    }
  });
  it('parallel status submissions change state and audit only once', async () => {
    const order = await assignedOrder(ctx);
    const results = await Promise.all([
      progress(order.id, 1, 'EN_ROUTE'),
      progress(order.id, 1, 'EN_ROUTE'),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: order.id, action: 'WORK_ORDER_STATUS_CHANGED' },
      }),
    ).toBe(1);
  });
  it('audit failure rolls back both cancellation writes', async () => {
    const order = await assignedOrder(ctx);
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    vi.spyOn(audit, 'record')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Fixture cancellation audit failure'));
    await cancel(order.requestId, order.request.version).expect(500);
    const stored = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { request: true },
    });
    expect(stored.status).toBe('ASSIGNED');
    expect(stored.version).toBe(1);
    expect(stored.request.status).toBe('APPROVED');
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: order.id, action: 'WORK_ORDER_CANCELLED' },
      }),
    ).toBe(0);
  });
  it('soft deleted requests hide their work and prevent changes', async () => {
    const order = await assignedOrder(ctx);
    await ctx.prisma.serviceRequest.update({
      where: { id: order.requestId },
      data: { deletedAt: new Date() },
    });
    await detail(order.id, ctx.admin.token).expect(404);
    await progress(order.id, 1, 'EN_ROUTE').expect(404);
  });
  it('concurrent reschedule and start cannot silently overwrite the same version', async () => {
    const order = await assignedOrder(ctx);
    const results = await Promise.all([
      progress(order.id, 1, 'EN_ROUTE'),
      request(ctx.app.getHttpServer())
        .patch(`/api/v1/work-orders/${order.id}/schedule`)
        .set('Authorization', `Bearer ${ctx.admin.token}`)
        .send({
          version: 1,
          technicianId: ctx.technician.id,
          ...visitWindow(30),
        }),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(
      (
        await ctx.prisma.workOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).version,
    ).toBe(2);
  });
  it('rolls back progress on audit failure and permits progress after catalog soft deletion', async () => {
    const order = await assignedOrder(ctx);
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Fixture progress audit failure'),
    );
    await progress(order.id, 1, 'EN_ROUTE').expect(500);
    expect(
      (
        await ctx.prisma.workOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('ASSIGNED');
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { deletedAt: new Date() },
    });
    await progress(order.id, 1, 'EN_ROUTE').expect(200);
  });
});
