import { randomUUID } from 'node:crypto';
import {
  closeRequestContext,
  createRequestContext,
  createOwnedRequest,
  type RequestContext,
} from './helpers/requests.js';

describe('Scheduling database invariants (e2e)', () => {
  let ctx: RequestContext;
  let requestId: string;
  let otherRequestId: string;
  let start: Date;
  let end: Date;
  beforeEach(async () => {
    ctx = await createRequestContext();
    requestId = (await createOwnedRequest(ctx)).id;
    otherRequestId = (await createOwnedRequest(ctx)).id;
    start = new Date(Date.now() + 86400000);
    end = new Date(start.getTime() + 3600000);
  });
  afterEach(() => closeRequestContext(ctx));
  const data = () => ({
    requestId,
    technicianId: ctx.technician.id,
    scheduledStart: start,
    scheduledEnd: end,
    agreedPriceMinor: 150000,
  });

  it('rejects overlapping active visits, allows exact adjacency and preserves cancellation history', async () => {
    const first = await ctx.prisma.workOrder.create({ data: data() });
    let exclusion: unknown;
    try {
      await ctx.prisma.workOrder.create({
        data: { ...data(), requestId: otherRequestId },
      });
    } catch (error) {
      exclusion = error;
    }
    expect(exclusion).toBeDefined();
    expect(exclusion).toMatchObject({
      code: 'P2039',
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    });
    await ctx.prisma.workOrder.create({
      data: {
        ...data(),
        requestId: otherRequestId,
        scheduledStart: end,
        scheduledEnd: new Date(end.getTime() + 3600000),
      },
    });
    await ctx.prisma.workOrder.update({
      where: { id: first.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await expect(
      ctx.prisma.workOrder.create({ data: data() }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      (
        await ctx.prisma.workOrder.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).cancelledAt,
    ).not.toBeNull();
  });

  it.each([
    { agreedPriceMinor: -1 },
    { agreedPriceMinor: 1000000001 },
    { version: 0 },
    { status: 'CANCELLED' as const },
    { status: 'COMPLETED' as const },
    { report: 'Unfinished work report' },
  ])('rejects invalid direct storage writes: %j', async (override) => {
    await expect(
      ctx.prisma.workOrder.create({ data: { ...data(), ...override } }),
    ).rejects.toThrow();
  });

  it('rejects empty/reversed/overlong ranges and enforces restrictive history references', async () => {
    for (const scheduledEnd of [
      start,
      new Date(start.getTime() - 1),
      new Date(start.getTime() + 8 * 3600000 + 1),
    ]) {
      await expect(
        ctx.prisma.workOrder.create({ data: { ...data(), scheduledEnd } }),
      ).rejects.toThrow();
    }
    await ctx.prisma.workOrder.create({ data: data() });
    await expect(
      ctx.prisma.serviceRequest.delete({ where: { id: requestId } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.user.delete({ where: { id: ctx.technician.id } }),
    ).rejects.toThrow();
  });

  it('enforces unique technician skills and referenced service/user retention', async () => {
    await ctx.prisma.technicianSkill.create({
      data: { userId: ctx.technician.id, serviceId: ctx.service.id },
    });
    await expect(
      ctx.prisma.technicianSkill.create({
        data: { userId: ctx.technician.id, serviceId: ctx.service.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      ctx.prisma.technicianSkill.create({
        data: { userId: randomUUID(), serviceId: ctx.service.id },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.user.delete({ where: { id: ctx.technician.id } }),
    ).rejects.toThrow();
  });
});
