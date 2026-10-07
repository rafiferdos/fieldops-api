import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import { runningOrder } from './helpers/completion.js';
import {
  assignedOrder,
  approvedRequest,
  assignRequest,
} from './helpers/scheduling.js';

const report = 'Inspected, cleaned and repaired the cooling unit.';
describe('Atomic work completion (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    return closeRequestContext(ctx);
  });
  const complete = (
    id: string,
    version: number,
    overrides: object = {},
    token = ctx.technician.token,
  ) =>
    request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version, report, ...overrides });

  it('completes work, issues the agreed-price invoice and audits both facts atomically', async () => {
    const order = await runningOrder(ctx);
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { basePriceMinor: 990000 },
    });
    const result = await complete(order.id, order.version, {
      report: `  ${report}  `,
    }).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data).toMatchObject({
      status: 'COMPLETED',
      version: 4,
      report,
      invoice: {
        workOrderId: order.id,
        customerId: ctx.owner.id,
        amountMinor: 150000,
        currency: 'BDT',
        status: 'UNPAID',
        paidAt: null,
      },
    });
    expect(result.body.data.completedAt).toBe(
      result.body.data.invoice.issuedAt,
    );
    const completionAudit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityId: order.id, action: 'WORK_ORDER_COMPLETED' },
    });
    expect(completionAudit.metadata).toMatchObject({
      previousVersion: 3,
      version: 4,
      invoiceId: result.body.data.invoice.id,
    });
    expect(JSON.stringify(completionAudit.metadata)).not.toContain(report);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityId: result.body.data.invoice.id,
          action: 'INVOICE_ISSUED',
        },
      }),
    ).toBe(1);
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id, {
      start: order.scheduledStart,
      end: order.scheduledEnd,
    }).expect(201);
  });
  it.each([0, 1000000000])(
    'preserves exact boundary money values: %s',
    async (amount) => {
      await ctx.prisma.service.update({
        where: { id: ctx.service.id },
        data: { basePriceMinor: amount },
      });
      const order = await runningOrder(ctx);
      const result = await complete(order.id, order.version).expect(200);
      expect(result.body.data.invoice.amountMinor).toBe(amount);
      expect(result.body.data.invoice.status).toBe('UNPAID');
    },
  );
  it('makes original/current-version retries idempotent without rewriting timestamps or audits', async () => {
    const order = await runningOrder(ctx);
    const first = await complete(order.id, order.version).expect(200);
    for (const version of [order.version, first.body.data.version]) {
      const repeat = await complete(order.id, version).expect(200);
      expect(repeat.body.data).toEqual(first.body.data);
    }
    expect(
      await ctx.prisma.invoice.count({ where: { workOrderId: order.id } }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: order.id, action: 'WORK_ORDER_COMPLETED' },
      }),
    ).toBe(1);
    await complete(order.id, order.version, {
      report: 'A different completed report.',
    }).expect(409);
    await complete(order.id, 1).expect(409);
  });
  it('identical concurrent completions return the same invoice and create one audit per event', async () => {
    const order = await runningOrder(ctx);
    const results = await Promise.all([
      complete(order.id, order.version),
      complete(order.id, order.version),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data.invoice.id).toBe(
      results[1]!.body.data.invoice.id,
    );
    expect(
      await ctx.prisma.invoice.count({ where: { workOrderId: order.id } }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { entityId: order.id, action: 'WORK_ORDER_COMPLETED' },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityId: results[0]!.body.data.invoice.id,
          action: 'INVOICE_ISSUED',
        },
      }),
    ).toBe(1);
  });
  it('different concurrent reports have one winner and one frozen-report conflict', async () => {
    const order = await runningOrder(ctx);
    const results = await Promise.all([
      complete(order.id, order.version),
      complete(order.id, order.version, {
        report: 'An alternative completed repair.',
      }),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const winner = results.find((r) => r.status === 200)!;
    expect(
      (
        await ctx.prisma.workOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).report,
    ).toBe(winner.body.data.report);
  });
  it.each(['owner', 'admin'] as const)('denies %s completion', async (role) => {
    const order = await runningOrder(ctx);
    await complete(order.id, order.version, {}, ctx[role].token).expect(403);
  });
  it('hides foreign work from an unassigned technician and rejects missing IDs', async () => {
    const order = await runningOrder(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { role: 'TECHNICIAN' },
    });
    await complete(order.id, order.version, {}, ctx.other.token).expect(404);
    await complete(randomUUID(), 1).expect(404);
    await complete('invalid', 1).expect(400);
  });
  it('requires fresh session/account/role authority', async () => {
    const order = await runningOrder(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'SUSPENDED' },
    });
    await complete(order.id, order.version).expect(401);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'ACTIVE', role: 'CUSTOMER' },
    });
    await complete(order.id, order.version).expect(403);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { role: 'TECHNICIAN' },
    });
    await ctx.prisma.session.updateMany({
      where: { userId: ctx.technician.id },
      data: { revokedAt: new Date() },
    });
    await complete(order.id, order.version).expect(401);
  });
  it('rejects early completion, stale versions and cancellation of completed work', async () => {
    const assigned = await assignedOrder(ctx);
    await complete(assigned.id, 1).expect(409);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${assigned.id}/status`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({ version: 1, status: 'EN_ROUTE' })
      .expect(200);
    await complete(assigned.id, 2).expect(409);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/work-orders/${assigned.id}/status`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({ version: 2, status: 'IN_PROGRESS' })
      .expect(200);
    await complete(assigned.id, 2).expect(409);
    await complete(assigned.id, 3).expect(200);
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/requests/${assigned.requestId}/cancel`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ version: assigned.request.version, reason: 'Already completed' })
      .expect(409);
  });
  it.each([
    { report: '' },
    { report: 'short' },
    { report: 'x'.repeat(2001) },
    { report: null },
    { amountMinor: 1 },
    { customerId: randomUUID() },
    { status: 'PAID' },
    { paidAt: new Date().toISOString() },
    { version: '3' },
    { version: 0 },
  ])(
    'rejects invalid input and untrusted money facts: %j',
    async (override) => {
      const order = await runningOrder(ctx);
      await complete(order.id, order.version, override).expect(400);
      expect(
        await ctx.prisma.invoice.count({ where: { workOrderId: order.id } }),
      ).toBe(0);
    },
  );
  it('rolls back report, status, invoice and both audits when the final audit fails', async () => {
    const order = await runningOrder(ctx);
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    vi.spyOn(audit, 'record')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Fixture invoice audit failure'));
    await complete(order.id, order.version).expect(500);
    const stored = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.version).toBe(3);
    expect(stored.report).toBeNull();
    expect(stored.completedAt).toBeNull();
    expect(
      await ctx.prisma.invoice.count({ where: { workOrderId: order.id } }),
    ).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          actorId: ctx.technician.id,
          action: { in: ['WORK_ORDER_COMPLETED', 'INVOICE_ISSUED'] },
        },
      }),
    ).toBe(0);
    await complete(order.id, order.version).expect(200);
  });
  it('preserves valid completion after catalog soft deletion and hides soft-deleted requests', async () => {
    const order = await runningOrder(ctx);
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { deletedAt: new Date() },
    });
    await complete(order.id, order.version).expect(200);
    await ctx.prisma.serviceRequest.update({
      where: { id: order.requestId },
      data: { deletedAt: new Date() },
    });
    await complete(order.id, order.version).expect(404);
  });
});
