import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { RequestsService } from '../src/modules/requests/requests.service.js';
import {
  closeRequestContext,
  createRequestContext,
  createOwnedRequest,
  type RequestContext,
} from './helpers/requests.js';

describe('Versioned request transitions (e2e)', () => {
  let ctx: RequestContext;
  let id: string;
  beforeEach(async () => {
    ctx = await createRequestContext();
    id = (await createOwnedRequest(ctx)).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const patch = (body: object, token = ctx.owner.token, target = id) =>
    request(ctx.app.getHttpServer())
      .patch(`/api/v1/requests/${target}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const review = (body: object, token = ctx.admin.token, target = id) =>
    request(ctx.app.getHttpServer())
      .patch(`/api/v1/requests/${target}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const cancel = (body: object, token = ctx.owner.token, target = id) =>
    request(ctx.app.getHttpServer())
      .post(`/api/v1/requests/${target}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const stored = () =>
    ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id } });
  const events = () =>
    ctx.prisma.auditLog.findMany({ where: { entityId: id } });

  it('edits pending fields, reviews and cancels approved work intent with fresh versions and safe audits', async () => {
    const edited = await patch({
      version: 1,
      address: 'House 25, Road 4, Dhaka',
    })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(edited.body.data).toMatchObject({
      version: 2,
      status: 'PENDING',
      address: 'House 25, Road 4, Dhaka',
      description: 'The cooling unit needs inspection.',
    });
    await review({ version: 1, decision: 'APPROVE' }).expect(409);
    const approved = await review({
      version: 2,
      decision: 'APPROVE',
      reason: '  Approved for dispatch  ',
    }).expect(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      version: 3,
      reviewReason: 'Approved for dispatch',
      reviewedAt: expect.any(String),
    });
    await patch({ version: 3, address: 'House 99, Road 4, Dhaka' }).expect(409);
    const cancelled = await cancel({
      version: 3,
      reason: '  Plans have changed  ',
    }).expect(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      version: 4,
      cancellationReason: 'Plans have changed',
      cancelledAt: expect.any(String),
      reviewedAt: approved.body.data.reviewedAt,
    });
    const audit = await events();
    expect(audit).toHaveLength(4);
    expect(
      audit.find((event) => event.action === 'REQUEST_UPDATED')?.metadata,
    ).toEqual({ updatedFields: ['address'], previousVersion: 1, version: 2 });
    expect(
      audit.find((event) => event.action === 'REQUEST_REVIEWED')?.metadata,
    ).toEqual({
      fromStatus: 'PENDING',
      toStatus: 'APPROVED',
      previousVersion: 2,
      version: 3,
    });
    expect(
      audit.find((event) => event.action === 'REQUEST_CANCELLED')?.metadata,
    ).toEqual({
      fromStatus: 'APPROVED',
      toStatus: 'CANCELLED',
      previousVersion: 3,
      version: 4,
    });
    expect(JSON.stringify(audit)).not.toContain('Plans have changed');
    expect(JSON.stringify(audit)).not.toContain('House 25');
    expect((await stored()).deletedAt).toBeNull();
  });

  it('requires a rejection reason and keeps rejected state terminal', async () => {
    await review({ version: 1, decision: 'REJECT' }).expect(400);
    await review({
      version: 1,
      decision: 'REJECT',
      reason: 'Outside service coverage',
    }).expect(200);
    expect(await stored()).toMatchObject({
      status: 'REJECTED',
      version: 2,
      reviewReason: 'Outside service coverage',
    });
    await cancel({ version: 2, reason: 'Cancel rejection' }).expect(409);
    await patch({ version: 2, address: 'House 44, Road 5, Dhaka' }).expect(409);
    await review({ version: 2, decision: 'APPROVE' }).expect(409);
    expect(await events()).toHaveLength(2);
  });

  it.each(['owner', 'admin'] as const)(
    'allows %s to cancel a pending request, then rejects repeat/terminal changes',
    async (who) => {
      await cancel(
        { version: 1, reason: 'Visit no longer needed' },
        ctx[who].token,
      ).expect(200);
      expect(await stored()).toMatchObject({
        status: 'CANCELLED',
        version: 2,
        reviewReason: null,
        reviewedAt: null,
      });
      await cancel(
        { version: 1, reason: 'Repeated cancel' },
        ctx[who].token,
      ).expect(409);
      await cancel(
        { version: 2, reason: 'Repeated cancel' },
        ctx[who].token,
      ).expect(409);
      await review({ version: 2, decision: 'APPROVE' }).expect(409);
      const audit = (await events()).find(
        (event) => event.action === 'REQUEST_CANCELLED',
      );
      expect(audit?.actorId).toBe(ctx[who].id);
      expect(await events()).toHaveLength(2);
    },
  );

  it.each([
    {},
    { version: 1 },
    { version: '1', address: 'New customer address' },
    { version: 0, address: 'New customer address' },
    { version: 1, customerId: randomUUID(), address: 'New customer address' },
    { version: 1, serviceId: randomUUID(), description: 'A valid description' },
    { version: 1, status: 'APPROVED', description: 'A valid description' },
    { version: 1, address: 'short' },
    { version: 1, description: null },
    { version: 1, preferredStart: '2020-01-01T00:00:00Z' },
    { version: 1, preferredStart: 'invalid' },
    { version: 1, deletedAt: null },
  ])(
    'rejects invalid/privileged edits without changing version: %j',
    async (body) => {
      await patch(body).expect(400);
      expect(await stored()).toMatchObject({ version: 1, status: 'PENDING' });
      expect(await events()).toHaveLength(1);
    },
  );

  it.each([
    {},
    { version: 1, decision: 'APPROVED' },
    { version: 1, decision: 'REJECT', reason: ' ' },
    { version: 1, decision: 'APPROVE', reason: 'a'.repeat(501) },
    { version: 1, decision: 'APPROVE', customerId: randomUUID() },
  ])('rejects invalid review input: %j', async (body) => {
    await review(body).expect(400);
    expect((await stored()).version).toBe(1);
  });

  it.each([
    {},
    { version: 1 },
    { version: 1, reason: ' ' },
    { version: 1, reason: 'a'.repeat(501) },
    { version: 1, reason: 'Cancellation', status: 'CANCELLED' },
  ])('rejects invalid cancellation input: %j', async (body) => {
    await cancel(body).expect(400);
    expect((await stored()).version).toBe(1);
  });

  it('enforces route roles and checks ownership before exposing a version conflict', async () => {
    await patch(
      { version: 1, address: 'New customer address' },
      ctx.admin.token,
    ).expect(403);
    await patch(
      { version: 1, address: 'New customer address' },
      ctx.technician.token,
    ).expect(403);
    await review({ version: 1, decision: 'APPROVE' }, ctx.owner.token).expect(
      403,
    );
    await review(
      { version: 1, decision: 'APPROVE' },
      ctx.technician.token,
    ).expect(403);
    await cancel(
      { version: 1, reason: 'Not my assignment' },
      ctx.technician.token,
    ).expect(403);
    await patch(
      { version: 999, address: 'Foreign customer address' },
      ctx.other.token,
    ).expect(404);
    await cancel(
      { version: 999, reason: 'Foreign cancellation' },
      ctx.other.token,
    ).expect(404);
    expect(await events()).toHaveLength(1);
  });

  it('rejects missing/invalid/soft-deleted IDs for all transitions', async () => {
    for (const target of ['invalid', randomUUID()]) {
      const status = target === 'invalid' ? 400 : 404;
      await patch(
        { version: 1, address: 'New customer address' },
        ctx.owner.token,
        target,
      ).expect(status);
      await review(
        { version: 1, decision: 'APPROVE' },
        ctx.admin.token,
        target,
      ).expect(status);
      await cancel(
        { version: 1, reason: 'Cancellation reason' },
        ctx.owner.token,
        target,
      ).expect(status);
    }
    await ctx.prisma.serviceRequest.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await patch({ version: 1, address: 'New customer address' }).expect(404);
    await review({ version: 1, decision: 'APPROVE' }).expect(404);
    await cancel({ version: 1, reason: 'Cancellation reason' }).expect(404);
  });

  it('lets only one same-version concurrent edit succeed; stale retry preserves omitted fields', async () => {
    const responses = await Promise.all([
      patch({ version: 1, address: 'New customer address' }),
      patch({ version: 1, description: 'A new detailed description.' }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect((await stored()).version).toBe(2);
    const loser =
      responses[0]!.status === 409
        ? { address: 'New customer address' }
        : { description: 'A new detailed description.' };
    await patch({ version: 2, ...loser }).expect(200);
    expect(await stored()).toMatchObject({
      version: 3,
      address: 'New customer address',
      description: 'A new detailed description.',
    });
    expect(await events()).toHaveLength(3);
  });

  it('serializes competing approve/reject decisions', async () => {
    const responses = await Promise.all([
      review({ version: 1, decision: 'APPROVE' }),
      review({
        version: 1,
        decision: 'REJECT',
        reason: 'Unavailable in this area',
      }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    const state = await stored();
    expect(state.version).toBe(2);
    expect(state.status).toBe(
      responses[0]!.status === 200 ? 'APPROVED' : 'REJECTED',
    );
    expect(await events()).toHaveLength(2);
  });

  it('serializes cancellation/review races and records only the winning transition', async () => {
    const responses = await Promise.all([
      cancel({ version: 1, reason: 'Plans have changed' }),
      review({ version: 1, decision: 'APPROVE' }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(await stored()).toMatchObject({
      version: 2,
      status: responses[0]!.status === 200 ? 'CANCELLED' : 'APPROVED',
    });
    expect(await events()).toHaveLength(2);
  });

  it.each(['update', 'review', 'cancel'] as const)(
    'rolls back %s state/version when audit persistence fails',
    async (action) => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
        new Error('Audit unavailable'),
      );
      if (action === 'update')
        await patch({ version: 1, address: 'Must be rolled back' }).expect(500);
      if (action === 'review')
        await review({ version: 1, decision: 'APPROVE' }).expect(500);
      if (action === 'cancel')
        await cancel({ version: 1, reason: 'Must be rolled back' }).expect(500);
      expect(await stored()).toMatchObject({
        version: 1,
        status: 'PENDING',
        address: 'House 12, Road 3, Dhaka',
        reviewedAt: null,
        cancelledAt: null,
      });
      expect(await events()).toHaveLength(1);
    },
  );

  it.each(['suspended', 'deleted', 'revoked', 'expired'])(
    'rejects %s actors at guards and direct mutation boundaries',
    async (state) => {
      if (state === 'suspended')
        await ctx.prisma.user.update({
          where: { id: ctx.owner.id },
          data: { status: 'SUSPENDED' },
        });
      if (state === 'deleted')
        await ctx.prisma.user.update({
          where: { id: ctx.owner.id },
          data: { deletedAt: new Date() },
        });
      if (state === 'revoked')
        await ctx.prisma.session.update({
          where: { id: ctx.owner.actor.sessionId },
          data: { revokedAt: new Date() },
        });
      if (state === 'expired')
        await ctx.prisma.session.update({
          where: { id: ctx.owner.actor.sessionId },
          data: { expiresAt: new Date(0) },
        });
      await patch({ version: 1, address: 'Blocked address update' }).expect(
        401,
      );
      await expect(
        ctx.app.get(RequestsService).update(ctx.owner.actor, id, {
          version: 1,
          address: 'Blocked address update',
        }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        ctx.app.get(RequestsService).cancel(ctx.owner.actor, id, {
          version: 1,
          reason: 'Blocked cancellation',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(await events()).toHaveLength(1);
    },
  );

  it('uses the current admin role and session when invoked directly', async () => {
    await ctx.prisma.user.update({
      where: { id: ctx.admin.id },
      data: { role: 'CUSTOMER' },
    });
    await expect(
      ctx.app
        .get(RequestsService)
        .review(ctx.admin.actor, id, { version: 1, decision: 'APPROVE' }),
    ).rejects.toMatchObject({ status: 403 });
    await ctx.prisma.session.update({
      where: { id: ctx.admin.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(
      ctx.app
        .get(RequestsService)
        .review(ctx.admin.actor, id, { version: 1, decision: 'APPROVE' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('requires authentication for every transition', async () => {
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/requests/${id}`)
      .send({ version: 1, address: 'Anonymous address update' })
      .expect(401);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/requests/${id}/review`)
      .send({ version: 1, decision: 'APPROVE' })
      .expect(401);
    await request(ctx.app.getHttpServer())
      .post(`/api/v1/requests/${id}/cancel`)
      .send({ version: 1, reason: 'Anonymous cancellation' })
      .expect(401)
      .expect('Cache-Control', 'no-store');
  });
});
