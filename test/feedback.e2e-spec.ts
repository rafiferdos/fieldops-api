import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { FeedbackService } from '../src/modules/feedback/feedback.service.js';
import { closeRequestContext } from './helpers/requests.js';
import { assignedOrder } from './helpers/scheduling.js';
import {
  createFeedbackContext,
  payFeedbackInvoice,
  submitFeedback,
  type FeedbackContext,
} from './helpers/feedback.js';

describe('Customer feedback HTTP workflow', () => {
  let ctx: FeedbackContext;
  beforeEach(async () => {
    ctx = await createFeedbackContext();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const rows = () =>
    ctx.prisma.feedback.findMany({ where: { workOrderId: ctx.workOrderId } });
  const audits = () =>
    ctx.prisma.auditLog.findMany({
      where: { entityId: ctx.workOrderId, action: 'FEEDBACK_SUBMITTED' },
    });

  it('creates safe normalized feedback and one audit after server-verified payment', async () => {
    await payFeedbackInvoice(ctx);
    const response = await submitFeedback(ctx, {
      rating: 5,
      comment: '  Excellent service.\nThanks!  ',
    }).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: expect.any(String),
        workOrderId: ctx.workOrderId,
        rating: 5,
        comment: 'Excellent service.\nThanks!',
        createdAt: expect.any(String),
      },
    });
    expect((await rows())[0]).toMatchObject({
      id: response.body.data.id,
      customerId: ctx.owner.id,
    });
    const events = await audits();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: ctx.owner.id,
      entityType: 'WORK_ORDER',
      metadata: { feedbackId: response.body.data.id, rating: 5 },
    });
    expect(JSON.stringify(events)).not.toContain('Excellent service');
  });
  it('supports a rating-only submission without rewriting lifecycle state', async () => {
    await payFeedbackInvoice(ctx);
    const result = await submitFeedback(ctx, { rating: 1 }).expect(201);
    expect(result.body.data.comment).toBeNull();
    const order = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: ctx.workOrderId },
    });
    expect(order.version).toBe(4); // Feedback does not rewrite lifecycle state/version.
  });
  it('accepts the comment length boundary without truncation', async () => {
    await payFeedbackInvoice(ctx);
    const comment = 'é'.repeat(1000);
    const response = await submitFeedback(ctx, { rating: 3, comment }).expect(
      201,
    );
    expect(response.body.data.comment).toBe(comment);
  });
  it('rejects all repeat submissions without rewriting the original review or audit', async () => {
    await payFeedbackInvoice(ctx);
    const first = await submitFeedback(ctx).expect(201);
    await submitFeedback(ctx).expect(409);
    await submitFeedback(ctx, {
      rating: 1,
      comment: 'A changed review.',
    }).expect(409);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      id: first.body.data.id,
      rating: first.body.data.rating,
      comment: first.body.data.comment,
    });
    expect(await audits()).toHaveLength(1);
  });
  it('serializes concurrent submissions into one success and conflicts', async () => {
    await payFeedbackInvoice(ctx);
    const responses = await Promise.all(
      [1, 2, 3, 4].map((rating) => submitFeedback(ctx, { rating })),
    );
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409, 409, 409,
    ]);
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    expect((await rows())[0]!.rating).toBe(
      responses.find((r) => r.status === 201)!.body.data.rating,
    );
  });
  it('returns private 404 before revealing eligibility or existing feedback', async () => {
    await submitFeedback(ctx, { rating: 5 }, ctx.other.token).expect(404);
    await submitFeedback(
      ctx,
      { rating: 5 },
      ctx.owner.token,
      randomUUID(),
    ).expect(404);
    await payFeedbackInvoice(ctx);
    await submitFeedback(ctx).expect(201);
    await submitFeedback(ctx, { rating: 5 }, ctx.other.token).expect(404);
  });
  it('requires customer authentication without an admin/technician bypass', async () => {
    for (const account of [ctx.admin, ctx.technician])
      await submitFeedback(ctx, { rating: 5 }, account.token).expect(403);
    const response = await request(ctx.app.getHttpServer())
      .post(`/api/v1/work-orders/${ctx.workOrderId}/feedback`)
      .send({ rating: 5 })
      .expect(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await rows()).toHaveLength(0);
  });
  it.each([
    'SUSPENDED',
    'DELETED',
    'REVOKED',
    'EXPIRED',
    'ROLE_CHANGED',
  ] as const)(
    'checks current account/session authority: %s',
    async (change) => {
      await payFeedbackInvoice(ctx);
      if (change === 'REVOKED' || change === 'EXPIRED')
        await ctx.prisma.session.update({
          where: { id: ctx.owner.actor.sessionId },
          data:
            change === 'REVOKED'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(0) },
        });
      else
        await ctx.prisma.user.update({
          where: { id: ctx.owner.id },
          data:
            change === 'SUSPENDED'
              ? { status: 'SUSPENDED' }
              : change === 'DELETED'
                ? { deletedAt: new Date() }
                : { role: 'ADMIN' },
        });
      await submitFeedback(ctx).expect(change === 'ROLE_CHANGED' ? 403 : 401);
      await expect(
        ctx.app
          .get(FeedbackService)
          .submit(ctx.owner.actor, ctx.workOrderId, { rating: 5 }),
      ).rejects.toMatchObject({
        status: change === 'ROLE_CHANGED' ? 403 : 401,
      });
      expect(await rows()).toHaveLength(0);
    },
  );
  it('rejects a completed unpaid order and a payment held for review', async () => {
    await submitFeedback(ctx).expect(409);
    await payFeedbackInvoice(ctx, true);
    await submitFeedback(ctx).expect(409);
    expect(await rows()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
  it.each(['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'CANCELLED'] as const)(
    'rejects unfinished/cancelled work: %s',
    async (status) => {
      const order = await assignedOrder(ctx);
      if (status === 'CANCELLED')
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/requests/${order.requestId}/cancel`)
          .set('Authorization', `Bearer ${ctx.owner.token}`)
          .send({ version: order.request.version, reason: 'Visit not needed.' })
          .expect(200);
      else if (status !== 'ASSIGNED') {
        await request(ctx.app.getHttpServer())
          .patch(`/api/v1/work-orders/${order.id}/status`)
          .set('Authorization', `Bearer ${ctx.technician.token}`)
          .send({ version: 1, status: 'EN_ROUTE' })
          .expect(200);
        if (status === 'IN_PROGRESS')
          await request(ctx.app.getHttpServer())
            .patch(`/api/v1/work-orders/${order.id}/status`)
            .set('Authorization', `Bearer ${ctx.technician.token}`)
            .send({ version: 2, status: 'IN_PROGRESS' })
            .expect(200);
      }
      await submitFeedback(
        ctx,
        { rating: 5 },
        ctx.owner.token,
        order.id,
      ).expect(409);
      expect(
        await ctx.prisma.feedback.count({ where: { workOrderId: order.id } }),
      ).toBe(0);
    },
  );
  it('hides a soft-deleted request and preserves eligibility after catalog soft deletion', async () => {
    await payFeedbackInvoice(ctx);
    await request(ctx.app.getHttpServer())
      .delete(`/api/v1/services/${ctx.service.id}`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .expect(200);
    await submitFeedback(ctx).expect(201);
    const order = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: ctx.workOrderId },
    });
    await ctx.prisma.serviceRequest.update({
      where: { id: order.requestId },
      data: { deletedAt: new Date() },
    });
    await submitFeedback(ctx).expect(404);
  });
  it.each([
    {},
    { rating: '5' },
    { rating: 0 },
    { rating: 6 },
    { rating: 1.5 },
    { rating: null },
    { rating: 5, comment: null },
    { rating: 5, comment: '  \n\t ' },
    { rating: 5, comment: 'x'.repeat(1001) },
    { rating: 5, comment: 'unsafe\u0000value' },
    { rating: 5, comment: 'unsafe\u0007value' },
    { rating: 5, customerId: 'chosen-owner' },
    { rating: 5, workOrderId: 'chosen-order' },
    { rating: 5, status: 'PAID' },
  ])('rejects invalid or server-owned input (%#)', async (body) => {
    const response = await submitFeedback(ctx, body).expect(400);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Request validation failed',
      errors: expect.any(Array),
    });
    expect(await rows()).toHaveLength(0);
  });
  it('validates the route UUID and body object shape', async () => {
    await submitFeedback(ctx, { rating: 5 }, ctx.owner.token, 'invalid').expect(
      400,
    );
    await submitFeedback(ctx, [{ rating: 5 }]).expect(400);
  });
  it('rolls back submission and audit together and permits a clean retry after audit failure', async () => {
    await payFeedbackInvoice(ctx);
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation((tx, event) => {
      if (event.action === 'FEEDBACK_SUBMITTED')
        throw new Error('Feedback audit unavailable');
      return original(tx, event);
    });
    const response = await submitFeedback(ctx).expect(500);
    expect(response.body.message).toBe('Internal server error');
    expect(await rows()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
    spy.mockRestore();
    await submitFeedback(ctx).expect(201);
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });
});
