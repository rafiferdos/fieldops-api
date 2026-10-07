import request from 'supertest';
import { closeRequestContext } from './helpers/requests.js';
import {
  createFeedbackContext,
  payFeedbackInvoice,
  submitFeedback,
  type FeedbackContext,
} from './helpers/feedback.js';

describe('Scoped feedback read models', () => {
  let ctx: FeedbackContext;
  beforeEach(async () => {
    ctx = await createFeedbackContext();
  });
  afterEach(() => closeRequestContext(ctx));

  const get = (path: string, token = ctx.owner.token) =>
    request(ctx.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  const order = () =>
    ctx.prisma.workOrder.findUniqueOrThrow({ where: { id: ctx.workOrderId } });
  it('returns null before submission across work and request read models', async () => {
    const work = await order();
    const detail = await get(`/work-orders/${work.id}`).expect(200);
    expect(detail.body.data.feedback).toBeNull();
    const list = await get(`/work-orders?serviceId=${ctx.service.id}`).expect(
      200,
    );
    expect(list.body.data.items[0].feedback).toBeNull();
    const ownRequest = await get(`/requests/${work.requestId}`).expect(200);
    expect(ownRequest.body.data.workOrder.feedback).toBeNull();
  });
  it('shares a safe persisted review between customer, assigned technician, admin and request summaries', async () => {
    await payFeedbackInvoice(ctx);
    const submission = await submitFeedback(ctx).expect(201);
    const feedback = submission.body.data;
    const work = await order();
    for (const account of [ctx.owner, ctx.technician, ctx.admin]) {
      const detail = await get(`/work-orders/${work.id}`, account.token).expect(
        200,
      );
      expect(detail.body.data.feedback).toEqual(feedback);
      expect(detail.headers['cache-control']).toBe('no-store');
      expect(
        detail.body.data.timeline.filter(
          (event: { action: string }) => event.action === 'FEEDBACK_SUBMITTED',
        ),
      ).toEqual([
        {
          id: expect.any(String),
          action: 'FEEDBACK_SUBMITTED',
          metadata: { feedbackId: feedback.id, rating: 5 },
          createdAt: expect.any(String),
        },
      ]);
      const list = await get(
        `/work-orders?serviceId=${ctx.service.id}`,
        account.token,
      ).expect(200);
      expect(list.body.data.items[0].feedback).toEqual(feedback);
    }
    for (const account of [ctx.owner, ctx.admin]) {
      const detail = await get(
        `/requests/${work.requestId}`,
        account.token,
      ).expect(200);
      expect(detail.body.data.workOrder.feedback).toEqual(feedback);
      const list = await get(
        `/requests?serviceId=${ctx.service.id}`,
        account.token,
      ).expect(200);
      expect(list.body.data.items[0].workOrder.feedback).toEqual(feedback);
    }
    expect(Object.keys(feedback).sort((a, b) => a.localeCompare(b))).toEqual([
      'comment',
      'createdAt',
      'id',
      'rating',
      'workOrderId',
    ]);
    expect(JSON.stringify(feedback)).not.toMatch(
      /customerId|email|phone|session|provider|token|hash/i,
    );
  });
  it('hides review content from another customer and unrelated technician', async () => {
    await payFeedbackInvoice(ctx);
    await submitFeedback(ctx, {
      rating: 5,
      comment: 'Private customer review.',
    }).expect(201);
    const work = await order();
    for (const account of [ctx.other]) {
      const detail = await get(`/work-orders/${work.id}`, account.token).expect(
        404,
      );
      expect(JSON.stringify(detail.body)).not.toContain(
        'Private customer review',
      );
      const list = await get(
        `/work-orders?serviceId=${ctx.service.id}`,
        account.token,
      ).expect(200);
      expect(list.body.data.items).toEqual([]);
      await get(`/requests/${work.requestId}`, account.token).expect(404);
    }
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { role: 'TECHNICIAN' },
    });
    await get(`/work-orders/${work.id}`, ctx.other.token).expect(404);
    const list = await get(
      `/work-orders?serviceId=${ctx.service.id}`,
      ctx.other.token,
    ).expect(200);
    expect(list.body.data.items).toEqual([]);
  });
  it('reads feedback from PostgreSQL and keeps it out of the public catalog', async () => {
    const before = await get(`/work-orders/${ctx.workOrderId}`).expect(200);
    expect(before.body.data.feedback).toBeNull();
    await payFeedbackInvoice(ctx);
    const submitted = await submitFeedback(ctx, {
      rating: 4,
      comment: 'Scoped review content.',
    }).expect(201);
    const after = await get(`/work-orders/${ctx.workOrderId}`).expect(200);
    expect(after.body.data.feedback).toEqual(submitted.body.data);
    const catalog = await request(ctx.app.getHttpServer())
      .get(`/api/v1/services/${ctx.service.id}`)
      .expect(200);
    expect(catalog.body.data).not.toHaveProperty('feedback');
    expect(JSON.stringify(catalog.body)).not.toContain('Scoped review content');
  });
});
