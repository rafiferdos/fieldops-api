import { settleStorageFixture } from './helpers/settlement-storage.js';
import { randomUUID } from 'node:crypto';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import { runningOrder } from './helpers/completion.js';
import { assignRequest, approvedRequest } from './helpers/scheduling.js';

describe('Immutable invoice storage (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => closeRequestContext(ctx));
  const snapshot = async () => {
    const order = await runningOrder(ctx);
    const issuedAt = new Date();
    const invoice = await ctx.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          report: 'Inspection and repair completed.',
          completedAt: issuedAt,
          version: { increment: 1 },
        },
      });
      return tx.invoice.create({
        data: {
          workOrderId: order.id,
          customerId: ctx.owner.id,
          amountMinor: order.agreedPriceMinor,
          currency: order.currency,
          issuedAt,
        },
      });
    });
    return { order, invoice };
  };
  it('requires one unique invoice and releases completed work scheduling capacity', async () => {
    const { order, invoice } = await snapshot();
    expect(invoice.status).toBe('UNPAID');
    expect(invoice.paidAt).toBeNull();
    await expect(
      ctx.prisma.invoice.create({
        data: {
          workOrderId: order.id,
          customerId: ctx.owner.id,
          amountMinor: order.agreedPriceMinor,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const req = await approvedRequest(ctx);
    await assignRequest(ctx, req.id, {
      start: order.scheduledStart,
      end: order.scheduledEnd,
    }).expect(201);
  });
  it('rejects completing work without an invoice at commit and rolls back', async () => {
    const order = await runningOrder(ctx);
    await expect(
      ctx.prisma.workOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          report: 'Completed without invoice.',
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await ctx.prisma.workOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('IN_PROGRESS');
  });
  it.each([
    { customerId: 'other' },
    { amountMinor: 1 },
    { amountMinor: -1 },
    { amountMinor: 1000000001 },
    { status: 'PAID' },
    { paidAt: 'now' },
    { issuedAt: 'early' },
  ])(
    'rejects a mismatched or invalid initial snapshot: %j',
    async (override) => {
      const order = await runningOrder(ctx);
      const completedAt = new Date();
      const data = {
        customerId: override.customerId ? ctx.other.id : ctx.owner.id,
        amountMinor: override.amountMinor ?? order.agreedPriceMinor,
        status:
          override.status === 'PAID' ? ('PAID' as const) : ('UNPAID' as const),
        ...(override.paidAt ? { paidAt: completedAt } : {}),
        issuedAt: override.issuedAt ? new Date(0) : completedAt,
      };
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.workOrder.update({
            where: { id: order.id },
            data: {
              status: 'COMPLETED',
              completedAt,
              report: 'Inspection and repair completed.',
            },
          });
          await tx.invoice.create({ data: { workOrderId: order.id, ...data } });
        }),
      ).rejects.toThrow();
      expect(
        await ctx.prisma.invoice.count({ where: { workOrderId: order.id } }),
      ).toBe(0);
      expect(
        (
          await ctx.prisma.workOrder.findUniqueOrThrow({
            where: { id: order.id },
          })
        ).status,
      ).toBe('IN_PROGRESS');
    },
  );
  it('rejects an invoice for work that is not completed', async () => {
    const order = await runningOrder(ctx);
    await expect(
      ctx.prisma.invoice.create({
        data: {
          workOrderId: order.id,
          customerId: ctx.owner.id,
          amountMinor: order.agreedPriceMinor,
        },
      }),
    ).rejects.toThrow();
  });
  it('freezes all invoice snapshot fields and prevents standalone invoice deletion', async () => {
    const { invoice } = await snapshot();
    for (const data of [
      { amountMinor: 1 },
      { customerId: ctx.other.id },
      { workOrderId: randomUUID() },
      { currency: 'USD' },
      { issuedAt: new Date(0) },
      { id: randomUUID() },
    ]) {
      // Unknown currency is rejected by the generated client; raw SQL verifies DB enum separately below.
      if ('currency' in data) {
        await expect(
          ctx.prisma
            .$executeRaw`UPDATE "Invoice" SET currency = 'USD' WHERE id = ${invoice.id}::uuid`,
        ).rejects.toThrow();
      } else
        await expect(
          ctx.prisma.invoice.update({ where: { id: invoice.id }, data }),
        ).rejects.toThrow();
    }
    await expect(
      ctx.prisma.invoice.delete({ where: { id: invoice.id } }),
    ).rejects.toThrow();
    expect(
      await ctx.prisma.invoice.findUnique({ where: { id: invoice.id } }),
    ).not.toBeNull();
  });
  it('freezes completed work and preserves original request ownership and price', async () => {
    const { order } = await snapshot();
    for (const data of [
      { report: 'A rewritten report.' },
      { status: 'IN_PROGRESS' as const, completedAt: null, report: null },
      { agreedPriceMinor: 1 },
      { technicianId: ctx.other.id },
      { scheduledEnd: new Date(new Date(order.scheduledEnd).getTime() + 1000) },
    ]) {
      await expect(
        ctx.prisma.workOrder.update({ where: { id: order.id }, data }),
      ).rejects.toThrow();
    }
    for (const data of [
      { customerId: ctx.other.id },
      { serviceId: randomUUID() },
      { id: randomUUID() },
    ])
      await expect(
        ctx.prisma.serviceRequest.update({
          where: { id: order.requestId },
          data,
        }),
      ).rejects.toThrow();
  });
  it('allows one settlement with valid paid facts and prevents reversal or rewriting paid time', async () => {
    const { invoice } = await snapshot();
    await expect(
      ctx.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID' },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date(0) },
      }),
    ).rejects.toThrow();
    const paidAt = new Date();
    await settleStorageFixture(ctx, invoice.id, paidAt);
    await expect(
      ctx.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'UNPAID', paidAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.invoice.update({
        where: { id: invoice.id },
        data: { paidAt: new Date(paidAt.getTime() + 1) },
      }),
    ).rejects.toThrow();
    expect(
      (
        await ctx.prisma.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
        })
      ).paidAt,
    ).toEqual(paidAt);
  });
});
