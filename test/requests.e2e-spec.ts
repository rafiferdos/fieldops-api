import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { RequestsService } from '../src/modules/requests/requests.service.js';
import { requestQuerySchema } from '../src/modules/requests/schemas/request.schema.js';
import {
  closeRequestContext,
  createRequestContext,
  createOwnedRequest,
  requestBody,
  type RequestContext,
} from './helpers/requests.js';

describe('Request creation and scoped reads (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const post = (body: object, token = ctx.owner.token) =>
    request(ctx.app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const detail = (id: string, token = ctx.owner.token) =>
    request(ctx.app.getHttpServer())
      .get(`/api/v1/requests/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const list = (query: object = {}, token = ctx.owner.token) =>
    request(ctx.app.getHttpServer())
      .get('/api/v1/requests')
      .set('Authorization', `Bearer ${token}`)
      .query(query);

  it('uses the authenticated owner, future UTC dates and privacy-safe audit metadata', async () => {
    const response = await post({
      ...requestBody(ctx),
      description: '  The cooling unit needs inspection.  ',
      preferredStart: '2099-01-01T10:00:00+06:00',
    })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const row = response.body.data;
    expect(row).toMatchObject({
      customerId: ctx.owner.id,
      serviceId: ctx.service.id,
      description: 'The cooling unit needs inspection.',
      preferredStart: '2099-01-01T04:00:00.000Z',
      status: 'PENDING',
      version: 1,
      service: { id: ctx.service.id, name: ctx.service.name },
    });
    expect(row).not.toHaveProperty('deletedAt');
    expect(row).not.toHaveProperty('customer');
    const event = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityId: row.id },
    });
    expect(event).toMatchObject({
      actorId: ctx.owner.id,
      action: 'REQUEST_CREATED',
      entityType: 'REQUEST',
      metadata: { serviceId: ctx.service.id, status: 'PENDING', version: 1 },
    });
    expect(JSON.stringify(event.metadata)).not.toContain(row.address);
    expect(
      (await detail(row.id).expect(200).expect('Cache-Control', 'no-store'))
        .body.data,
    ).toEqual(row);
  });

  it('scopes items and totals to the owner; admin sees both; other-owner details are hidden', async () => {
    const own = await createOwnedRequest(ctx);
    const other = await createOwnedRequest(ctx, ctx.other);
    const ownList = await list({
      serviceId: ctx.service.id,
      q: 'COOLING',
    }).expect(200);
    expect(
      ownList.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([own.id]);
    expect(ownList.body.data.pagination.total).toBe(1);
    const adminList = await list(
      { serviceId: ctx.service.id },
      ctx.admin.token,
    ).expect(200);
    expect(adminList.body.data.pagination.total).toBe(2);
    await detail(other.id).expect(404);
    await detail(own.id, ctx.other.token).expect(404);
    await detail(other.id, ctx.admin.token).expect(200);
    await list({ customerId: ctx.other.id }).expect(400);
  });

  it('retains old requests after service soft deletion but denies new ones', async () => {
    const own = await createOwnedRequest(ctx);
    await request(ctx.app.getHttpServer())
      .delete(`/api/v1/services/${ctx.service.id}`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .expect(200);
    await post(requestBody(ctx)).expect(404);
    expect((await detail(own.id).expect(200)).body.data.service.id).toBe(
      ctx.service.id,
    );
    expect(
      (await list({ serviceId: ctx.service.id }).expect(200)).body.data
        .pagination.total,
    ).toBe(1);
  });

  it('hides soft-deleted requests from customer and admin reads and totals', async () => {
    const own = await createOwnedRequest(ctx);
    await ctx.prisma.serviceRequest.update({
      where: { id: own.id },
      data: { deletedAt: new Date() },
    });
    await detail(own.id).expect(404);
    await detail(own.id, ctx.admin.token).expect(404);
    expect(
      (await list({ serviceId: ctx.service.id }, ctx.admin.token).expect(200))
        .body.data.pagination.total,
    ).toBe(0);
  });

  it.each(['newest', 'oldest', 'preferred_start_asc'] as const)(
    'provides stable sorting and pagination: %s',
    async (sort) => {
      // Set tied immutable timestamps at fixture insertion; production clients cannot choose them.
      const tiedData = {
        ...requestBody(ctx),
        customerId: ctx.owner.id,
        preferredStart: new Date('2099-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01'),
      };
      const a = await ctx.prisma.serviceRequest.create({
        data: tiedData,
        select: { id: true },
      });
      const b = await ctx.prisma.serviceRequest.create({
        data: tiedData,
        select: { id: true },
      });
      const first = await list({
        serviceId: ctx.service.id,
        page: 1,
        limit: 1,
        sort,
      }).expect(200);
      const second = await list({
        serviceId: ctx.service.id,
        page: 2,
        limit: 1,
        sort,
      }).expect(200);
      expect([
        first.body.data.items[0].id,
        second.body.data.items[0].id,
      ]).toEqual([a.id, b.id].sort());
      expect(first.body.data.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(
        (await list({ page: 3, limit: 1 }).expect(200)).body.data.items,
      ).toEqual([]);
    },
  );

  it.each(['%', '_', '\\'])(
    'searches literal metacharacters without broadening owner scope: %s',
    async (character) => {
      const matching = await createOwnedRequest(ctx, ctx.owner, {
        description: `Special ${character} request maintenance.`,
      });
      await createOwnedRequest(ctx, ctx.owner, {
        description: 'Normal request maintenance.',
      });
      await createOwnedRequest(ctx, ctx.other, {
        description: `Special ${character} request maintenance.`,
      });
      const response = await list({ q: character }).expect(200);
      expect(
        response.body.data.items.map((item: { id: string }) => item.id),
      ).toEqual([matching.id]);
    },
  );

  it.each([
    { customerId: randomUUID() },
    { status: 'APPROVED' },
    { version: 2 },
    { basePriceMinor: 1 },
    { description: 'short' },
    { address: 'short' },
    { preferredStart: 'invalid' },
    { preferredStart: '2020-01-01T00:00:00Z' },
    { preferredStart: '2099-01-01T10:00:00' },
    { serviceId: 'invalid' },
    { serviceId: null },
  ])('rejects invalid/privileged create input: %j', async (override) => {
    await post({ ...requestBody(ctx), ...override }).expect(400);
    expect(
      await ctx.prisma.serviceRequest.count({
        where: { customerId: ctx.owner.id },
      }),
    ).toBe(0);
  });

  it.each([
    { page: 0 },
    { limit: 101 },
    { status: 'PAID' },
    { sort: 'invalid' },
    { serviceId: 'invalid' },
    { q: 'a'.repeat(101) },
    { page: ['1', '2'] },
  ])('rejects malformed query: %j', async (query) => {
    await list(query).expect(400);
  });

  it('enforces all role restrictions, authentication and identifier validation', async () => {
    const own = await createOwnedRequest(ctx);
    await post(requestBody(ctx), ctx.admin.token).expect(403);
    await post(requestBody(ctx), ctx.technician.token).expect(403);
    await list({}, ctx.technician.token).expect(403);
    await detail(own.id, ctx.technician.token).expect(403);
    await detail('invalid').expect(400);
    await detail(randomUUID()).expect(404);
    await post({ ...requestBody(ctx), serviceId: randomUUID() }).expect(404);
    await request(ctx.app.getHttpServer())
      .get('/api/v1/requests')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await request(ctx.app.getHttpServer())
      .post('/api/v1/requests')
      .send(requestBody(ctx))
      .expect(401);
  });

  it('rolls back creation when the audit write fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Audit unavailable'),
    );
    await post(requestBody(ctx)).expect(500);
    expect(
      await ctx.prisma.serviceRequest.count({
        where: { customerId: ctx.owner.id },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({ where: { actorId: ctx.owner.id } }),
    ).toBe(0);
  });

  it('rechecks current role/session for direct service calls and scoped reads', async () => {
    const own = await createOwnedRequest(ctx);
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { role: 'TECHNICIAN' },
    });
    const service = ctx.app.get(RequestsService);
    await expect(service.detail(ctx.owner.actor, own.id)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      service.list(ctx.owner.actor, requestQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 403 });
    await ctx.prisma.session.update({
      where: { id: ctx.owner.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(service.detail(ctx.owner.actor, own.id)).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it('serializes service deletion against request acceptance', async () => {
    const responses = await Promise.all([
      post(requestBody(ctx)),
      request(ctx.app.getHttpServer())
        .delete(`/api/v1/services/${ctx.service.id}`)
        .set('Authorization', `Bearer ${ctx.admin.token}`),
    ]);
    expect(responses[1]!.status).toBe(200);
    expect([201, 404]).toContain(responses[0]!.status);
    expect(
      await ctx.prisma.serviceRequest.count({
        where: { customerId: ctx.owner.id },
      }),
    ).toBe(responses[0]!.status === 201 ? 1 : 0);
    await post(requestBody(ctx)).expect(404);
  });
});
