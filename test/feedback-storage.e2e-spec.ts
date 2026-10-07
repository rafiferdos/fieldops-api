import { randomUUID } from 'node:crypto';
import { closeRequestContext } from './helpers/requests.js';
import {
  createPaymentContext,
  type PaymentContext,
} from './helpers/payments.js';
import { settleStorageFixture } from './helpers/settlement-storage.js';
import { assignedOrder } from './helpers/scheduling.js';

describe('Customer feedback storage', () => {
  let ctx: PaymentContext;
  let workOrderId: string;
  beforeEach(async () => {
    ctx = await createPaymentContext();
    workOrderId = (
      await ctx.prisma.invoice.findUniqueOrThrow({
        where: { id: ctx.invoiceId },
      })
    ).workOrderId;
  });
  afterEach(() => closeRequestContext(ctx));
  const paid = () => settleStorageFixture(ctx, ctx.invoiceId, new Date());
  const submit = (
    data: {
      rating?: number;
      comment?: string | null;
      customerId?: string;
      workOrderId?: string;
    } = {},
  ) =>
    ctx.prisma.feedback.create({
      data: { workOrderId, customerId: ctx.owner.id, rating: 5, ...data },
    });

  it('rejects completed work until its invoice has verified settlement evidence', async () => {
    await expect(submit()).rejects.toThrow();
    expect(await ctx.prisma.feedback.count({ where: { workOrderId } })).toBe(0);
    await paid();
    expect(await submit()).toMatchObject({
      workOrderId,
      customerId: ctx.owner.id,
      rating: 5,
      comment: null,
    });
  });
  it('rejects unfinished work and mismatched customer ownership', async () => {
    const assigned = await assignedOrder(ctx);
    await expect(submit({ workOrderId: assigned.id })).rejects.toThrow();
    await paid();
    await expect(submit({ customerId: ctx.other.id })).rejects.toThrow();
    await expect(submit({ workOrderId: randomUUID() })).rejects.toThrow();
  });
  it('rejects feedback on a soft-deleted request', async () => {
    await paid();
    const order = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
    });
    await ctx.prisma.serviceRequest.update({
      where: { id: order.requestId },
      data: { deletedAt: new Date() },
    });
    await expect(submit()).rejects.toThrow();
  });
  it.each([0, 6, -1])(
    'rejects out-of-range rating %i below the API layer',
    async (rating) => {
      await paid();
      await expect(submit({ rating })).rejects.toThrow();
    },
  );
  it.each(['', ' \t\r\n ', 'x'.repeat(1001)])(
    'rejects an empty or oversized comment (%#)',
    async (comment) => {
      await paid();
      await expect(submit({ comment })).rejects.toThrow();
    },
  );
  it('supports rating boundaries, optional comments and a 1000-character comment', async () => {
    await paid();
    const feedback = await submit({ rating: 1, comment: 'x'.repeat(1000) });
    expect(feedback.comment).toHaveLength(1000);
    expect(feedback.rating).toBe(1);
  });
  it('enforces one submission even when concurrent writers bypass the service', async () => {
    await paid();
    const results = await Promise.allSettled([submit(), submit({ rating: 1 })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await ctx.prisma.feedback.count({ where: { workOrderId } })).toBe(1);
  });
  it('freezes feedback identity, ownership, rating, comment and timestamp', async () => {
    await paid();
    const feedback = await submit({ comment: 'Original review.' });
    for (const data of [
      { id: randomUUID() },
      { workOrderId: randomUUID() },
      { customerId: ctx.other.id },
      { rating: 1 },
      { comment: 'Rewritten review.' },
      { createdAt: new Date(0) },
    ])
      await expect(
        ctx.prisma.feedback.update({ where: { id: feedback.id }, data }),
      ).rejects.toThrow();
    expect(
      await ctx.prisma.feedback.findUnique({ where: { id: feedback.id } }),
    ).toEqual(feedback);
    await expect(
      ctx.prisma
        .$executeRaw`INSERT INTO "Feedback" (id, "workOrderId", "customerId", rating, "createdAt") VALUES (${randomUUID()}::uuid, ${workOrderId}::uuid, ${ctx.owner.id}::uuid, 5, 'infinity')`,
    ).rejects.toThrow();
  });
});
