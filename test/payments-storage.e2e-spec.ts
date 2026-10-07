import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runningOrder } from './helpers/completion.js';
import {
  closeRequestContext,
  createRequestContext,
  type RequestContext,
} from './helpers/requests.js';

describe('Payment storage invariants', () => {
  let ctx: RequestContext;
  let invoiceId: string;
  beforeEach(async () => {
    ctx = await createRequestContext();
    const order = await runningOrder(ctx);
    const response = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${ctx.technician.token}`)
      .send({ version: 3, report: 'Completed the inspection and repair.' })
      .expect(200);
    invoiceId = response.body.data.invoice.id as string;
  });
  afterEach(async () => {
    await closeRequestContext(ctx);
  });
  const data = () => ({
    invoiceId,
    userId: ctx.owner.id,
    amountMinor: 150000,
    gatewayMode: 'SANDBOX' as const,
    gatewayStoreId: 'fixture-store',
    merchantTranId: randomBytes(12).toString('hex'),
    idempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
  });

  it('reserves one live checkout and preserves the invoice snapshot', async () => {
    const first = await ctx.prisma.payment.create({ data: data() });
    expect(first.status).toBe('INITIATING');
    await expect(ctx.prisma.payment.create({ data: data() })).rejects.toThrow();
    expect(await ctx.prisma.payment.count({ where: { invoiceId } })).toBe(1);
  });
  it.each([
    { userId: 'foreign' },
    { amountMinor: 150001 },
    { amountMinor: 0 },
    { merchantTranId: 'bad' },
    { status: 'SUCCEEDED' },
  ])('rejects invalid initial facts %j', async (changes) => {
    const initial = data();
    if (changes.userId) changes = { userId: ctx.other.id };
    await expect(
      ctx.prisma.payment.create({
        data: { ...initial, ...changes } as typeof initial,
      }),
    ).rejects.toThrow();
    expect(await ctx.prisma.payment.count({ where: { invoiceId } })).toBe(0);
  });
  it('freezes identity and requires provider facts before success', async () => {
    const row = await ctx.prisma.payment.create({ data: data() });
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: { amountMinor: 151000 },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: { status: 'SUCCEEDED' },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: { status: 'PENDING' },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: {
          status: 'SUCCEEDED',
          verifiedAt: new Date(),
          settledAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await ctx.prisma.payment.update({
      where: { id: row.id },
      data: {
        status: 'SUCCEEDED',
        verifiedAt: new Date(),
        settledAt: new Date(),
        providerTranId: randomUUID(),
      },
    });
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: { status: 'FAILED' },
      }),
    ).rejects.toThrow();
  });
  it('requires verified terminal failure before a new attempt', async () => {
    const row = await ctx.prisma.payment.create({ data: data() });
    await expect(
      ctx.prisma.payment.update({
        where: { id: row.id },
        data: { status: 'FAILED' },
      }),
    ).rejects.toThrow();
    await ctx.prisma.payment.update({
      where: { id: row.id },
      data: { status: 'FAILED', verifiedAt: new Date() },
    });
    const second = await ctx.prisma.payment.create({ data: data() });
    expect(second.id).not.toBe(row.id);
  });
});
