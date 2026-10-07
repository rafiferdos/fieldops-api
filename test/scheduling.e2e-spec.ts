import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import {
  closeRequestContext,
  createRequestContext,
  createOwnedRequest,
  type RequestContext,
} from './helpers/requests.js';
import {
  approvedRequest,
  assignedOrder,
  assignRequest,
  grantSkill,
  visitWindow,
} from './helpers/scheduling.js';

describe('Assignment and rescheduling (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    return closeRequestContext(ctx);
  });
  const schedule = (id: string, input: object, token = ctx.admin.token) =>
    request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${id}/schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);

  it('snapshots server price and exposes current request version; ignores later price changes on reschedule', async () => {
    const order = await assignedOrder(ctx);
    expect(order.agreedPriceMinor).toBe(150000);
    expect(order.currency).toBe('BDT');
    expect(order.request.version).toBe(3);
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { basePriceMinor: 990000 },
    });
    const moved = await schedule(order.id, {
      version: 1,
      technicianId: ctx.technician.id,
      ...visitWindow(30),
    }).expect(200);
    expect(moved.body.data.agreedPriceMinor).toBe(150000);
    expect(moved.body.data.version).toBe(2);
    await schedule(order.id, {
      version: 1,
      technicianId: ctx.technician.id,
      ...visitWindow(32),
    }).expect(409);
  });
  it.each(['owner', 'technician'] as const)(
    'denies %s assignment and reschedule',
    async (role) => {
      const req = await approvedRequest(ctx);
      await assignRequest(ctx, req.id, {}, ctx[role].token).expect(403);
      await schedule(
        randomUUID(),
        { version: 1, technicianId: ctx.technician.id, ...visitWindow() },
        ctx[role].token,
      ).expect(403);
    },
  );
  it('rejects pending/cancelled requests, missing skills and repeat assignment', async () => {
    const pending = await createOwnedRequest(ctx);
    await assignRequest(ctx, pending.id).expect(409);
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id).expect(409);
    await grantSkill(ctx);
    await assignRequest(ctx, req.id).expect(201);
    await assignRequest(ctx, req.id).expect(409);
    const cancelled = await approvedRequest(ctx);
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/requests/${cancelled.id}/cancel`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ version: cancelled.version, reason: 'No longer needed' })
      .expect(200);
    await assignRequest(ctx, cancelled.id, visitWindow(28)).expect(409);
  });
  it('rejects unknown/deleted/suspended/wrong-role technicians and deleted requests/services', async () => {
    const req = await approvedRequest(ctx);
    await grantSkill(ctx);
    await assignRequest(ctx, req.id, { technicianId: randomUUID() }).expect(
      404,
    );
    await assignRequest(ctx, req.id, { technicianId: ctx.owner.id }).expect(
      404,
    );
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'SUSPENDED' },
    });
    await assignRequest(ctx, req.id).expect(404);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'ACTIVE', deletedAt: new Date() },
    });
    await assignRequest(ctx, req.id).expect(404);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { deletedAt: null },
    });
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { deletedAt: new Date() },
    });
    await assignRequest(ctx, req.id).expect(404);
    await ctx.prisma.serviceRequest.update({
      where: { id: req.id },
      data: { deletedAt: new Date() },
    });
    await assignRequest(ctx, req.id).expect(404);
  });
  it.each([
    { agreedPriceMinor: 1 },
    { status: 'COMPLETED' },
    { version: 1 },
    { start: '2020-01-01T00:00:00Z' },
    { start: '2028-01-01T00:00:00' },
    { start: '2028-01-01T00:00:00.1234Z' },
    { end: '2028-01-01T00:00:00Z' },
  ])('rejects invalid assignment input: %j', async (override) => {
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id, override).expect(400);
  });
  it('one request cannot be assigned twice concurrently', async () => {
    await grantSkill(ctx);
    const req = await approvedRequest(ctx);
    const results = await Promise.all([
      assignRequest(ctx, req.id),
      assignRequest(ctx, req.id),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      await ctx.prisma.workOrder.count({ where: { requestId: req.id } }),
    ).toBe(1);
    expect(
      (
        await ctx.prisma.serviceRequest.findUniqueOrThrow({
          where: { id: req.id },
        })
      ).version,
    ).toBe(3);
    expect(
      await ctx.prisma.auditLog.count({
        where: { actorId: ctx.admin.id, action: 'WORK_ORDER_ASSIGNED' },
      }),
    ).toBe(1);
  });
  it('two overlapping requests competing for one technician have exactly one winner', async () => {
    await grantSkill(ctx);
    const a = await approvedRequest(ctx);
    const b = await approvedRequest(ctx);
    const dates = visitWindow();
    const results = await Promise.all([
      assignRequest(ctx, a.id, dates),
      assignRequest(ctx, b.id, dates),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      await ctx.prisma.workOrder.count({
        where: { technicianId: ctx.technician.id },
      }),
    ).toBe(1);
  });
  it('permits exact adjacent bookings and keeps the old slot on a conflicting reschedule', async () => {
    const dates = visitWindow();
    const first = await assignedOrder(ctx, dates);
    const req = await approvedRequest(ctx);
    const next = {
      start: dates.end,
      end: new Date(new Date(dates.end).getTime() + 3600000).toISOString(),
    };
    const second = (await assignRequest(ctx, req.id, next).expect(201)).body
      .data;
    await schedule(second.id, {
      version: 1,
      technicianId: ctx.technician.id,
      ...dates,
    }).expect(409);
    const stored = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(stored.scheduledStart.toISOString()).toBe(next.start);
    expect(stored.version).toBe(1);
    await schedule(first.id, {
      version: 1,
      technicianId: ctx.technician.id,
      ...dates,
    }).expect(200);
  });
  it('rolls back assignment and request version if audit fails', async () => {
    await grantSkill(ctx);
    const req = await approvedRequest(ctx);
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Fixture assignment audit failure'),
    );
    await assignRequest(ctx, req.id).expect(500);
    expect(
      await ctx.prisma.workOrder.count({ where: { requestId: req.id } }),
    ).toBe(0);
    expect(
      (
        await ctx.prisma.serviceRequest.findUniqueOrThrow({
          where: { id: req.id },
        })
      ).version,
    ).toBe(2);
  });
  it('skill removal and assignment cannot commit an invalid active booking', async () => {
    await grantSkill(ctx);
    const req = await approvedRequest(ctx);
    const results = await Promise.all([
      assignRequest(ctx, req.id),
      request(ctx.app.getHttpServer())
        .put(`/api/v1/technicians/${ctx.technician.id}/skills`)
        .set('Authorization', `Bearer ${ctx.admin.token}`)
        .send({ serviceIds: [] }),
    ]);
    const statuses = results.map((r) => r.status);
    expect([
      [201, 409],
      [409, 200],
    ]).toContainEqual(statuses);
    const order = await ctx.prisma.workOrder.findUnique({
      where: { requestId: req.id },
    });
    if (order)
      expect(
        await ctx.prisma.technicianSkill.count({
          where: { userId: ctx.technician.id, serviceId: ctx.service.id },
        }),
      ).toBe(1);
  });
  it('normalizes valid UUID casing and rejects case-insensitive duplicate skills', async () => {
    await request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${ctx.technician.id.toUpperCase()}/skills`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ serviceIds: [ctx.service.id.toUpperCase()] })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${ctx.technician.id}/skills`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ serviceIds: [ctx.service.id, ctx.service.id.toUpperCase()] })
      .expect(400);
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id.toUpperCase(), {
      technicianId: ctx.technician.id.toUpperCase(),
    }).expect(201);
  });
  it('allows different technicians to visit in the same time window', async () => {
    await grantSkill(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { role: 'TECHNICIAN' },
    });
    await request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${ctx.other.id}/skills`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ serviceIds: [ctx.service.id] })
      .expect(200);
    const a = await approvedRequest(ctx);
    const b = await approvedRequest(ctx);
    const dates = visitWindow();
    const results = await Promise.all([
      assignRequest(ctx, a.id, dates),
      assignRequest(ctx, b.id, { ...dates, technicianId: ctx.other.id }),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
  });
  it('parallel reschedules honor one expected version and audit only the winner', async () => {
    const order = await assignedOrder(ctx);
    const results = await Promise.all([
      schedule(order.id, {
        version: 1,
        technicianId: ctx.technician.id,
        ...visitWindow(28),
      }),
      schedule(order.id, {
        version: 1,
        technicianId: ctx.technician.id,
        ...visitWindow(30),
      }),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: order.id, action: 'WORK_ORDER_RESCHEDULED' },
      }),
    ).toBe(1);
  });
  it('rolls back rescheduling and retains the price/slot on audit failure', async () => {
    const order = await assignedOrder(ctx);
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Fixture schedule audit failure'),
    );
    await schedule(order.id, {
      version: 1,
      technicianId: ctx.technician.id,
      ...visitWindow(30),
    }).expect(500);
    const stored = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.scheduledStart.toISOString()).toBe(order.scheduledStart);
    expect(stored.version).toBe(1);
  });
});
