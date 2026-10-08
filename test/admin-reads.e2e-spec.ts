import request from 'supertest';
import {
  createRequestContext,
  closeRequestContext,
  type RequestContext,
} from './helpers/requests.js';

describe('Administration reads (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(async () => closeRequestContext(ctx));
  const get = (path: string, token = ctx.admin.token) =>
    request(ctx.app.getHttpServer())
      .get('/api/v1/admin/' + path)
      .set('Authorization', `Bearer ${token}`);

  it('restricts both lists to active ADMIN sessions and never caches private records', async () => {
    for (const path of ['users', 'audit-logs']) {
      await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/' + path)
        .expect(401);
      await get(path, ctx.owner.token).expect(403);
      await get(path, ctx.technician.token).expect(403);
      const response = await get(path).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    await ctx.prisma.session.updateMany({
      where: { userId: ctx.admin.id },
      data: { revokedAt: new Date() },
    });
    await get('users').expect(401);
  });

  it('filters, paginates and projects users without private authentication fields', async () => {
    const response = await get(
      `users?q=${ctx.owner.email}&role=CUSTOMER&status=ACTIVE&limit=1&sort=oldest`,
    ).expect(200);
    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
    expect(response.body.data.items[0]).toMatchObject({
      id: ctx.owner.id,
      status: 'ACTIVE',
      role: 'CUSTOMER',
    });
    expect(Object.keys(response.body.data.items[0]).sort()).toEqual(
      [
        'id',
        'name',
        'email',
        'role',
        'status',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    await ctx.prisma.user.update({
      where: { id: ctx.owner.id },
      data: { deletedAt: new Date() },
    });
    expect(
      (await get(`users?q=${ctx.owner.email}`).expect(200)).body.data.items,
    ).toEqual([]);
    await get('users?limit=101').expect(400);
    await get('users?passwordHash=true').expect(400);
    await get('users?role=DISPATCHER').expect(400);
  });

  it('filters audit history and strips unexpected metadata without exposing relations', async () => {
    const row = await ctx.prisma.auditLog.create({
      data: {
        actorId: ctx.admin.id,
        entityId: ctx.owner.id,
        entityType: 'USER',
        action: 'USER_PROFILE_UPDATED',
        metadata: {
          updatedFields: ['name'],
          passwordHash: 'sensitive',
          providerPayload: { token: 'sensitive' },
        },
      },
    });
    const response = await get(
      `audit-logs?actorId=${ctx.admin.id}&entityId=${ctx.owner.id}&entityType=USER&action=USER_PROFILE_UPDATED`,
    ).expect(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      id: row.id,
      metadata: { updatedFields: ['name'] },
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    const time = row.createdAt.toISOString();
    const end = new Date(row.createdAt.getTime() + 1).toISOString();
    expect(
      (
        await get(
          `audit-logs?entityId=${ctx.owner.id}&from=${time}&to=${end}`,
        ).expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    const start = new Date(row.createdAt.getTime() - 1).toISOString();
    expect(
      (
        await get(
          `audit-logs?entityId=${ctx.owner.id}&from=${start}&to=${time}`,
        ).expect(200)
      ).body.data.items,
    ).toHaveLength(0);
    await get('audit-logs?from=2026-01-01T00:00:00Z').expect(400);
    await get(
      'audit-logs?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z',
    ).expect(400);
  });
});
