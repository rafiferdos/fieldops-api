import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import {
  closeRequestContext,
  createRequestContext,
  createOwnedRequest,
  type RequestContext,
} from './helpers/requests.js';

describe('Technician skills and availability (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    return closeRequestContext(ctx);
  });
  const skills = (
    serviceIds: string[],
    token = ctx.admin.token,
    id = ctx.technician.id,
  ) =>
    request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${id}/skills`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceIds });
  const window = () => {
    const start = new Date(Date.now() + 86400000);
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
    };
  };
  const available = (overrides: object = {}, token = ctx.admin.token) =>
    request(ctx.app.getHttpServer())
      .get('/api/v1/technicians')
      .set('Authorization', `Bearer ${token}`)
      .query({ serviceId: ctx.service.id, ...window(), ...overrides });

  it('replaces skills, supports empty replacement, audits and excludes private account fields', async () => {
    await skills([ctx.service.id]).expect(200);
    const result = await available().expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.items).toContainEqual({
      id: ctx.technician.id,
      name: 'Request Fixture',
    });
    expect(JSON.stringify(result.body)).not.toContain(ctx.technician.email);
    await skills([]).expect(200);
    expect(
      (await available().expect(200)).body.data.items.some(
        (u: { id: string }) => u.id === ctx.technician.id,
      ),
    ).toBe(false);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityId: ctx.technician.id,
          action: 'TECHNICIAN_SKILLS_UPDATED',
        },
      }),
    ).toBe(2);
  });
  it.each(['owner', 'other', 'technician'] as const)(
    'denies %s dispatch access',
    async (role) => {
      await skills([ctx.service.id], ctx[role].token).expect(403);
      await available({}, ctx[role].token).expect(403);
    },
  );
  it('rejects untrusted fields, duplicates, invalid UUIDs and wrong account roles', async () => {
    await skills([ctx.service.id, ctx.service.id]).expect(400);
    await skills(['invalid']).expect(400);
    await skills([ctx.service.id], ctx.admin.token, ctx.owner.id).expect(404);
    await skills([randomUUID()]).expect(404);
    await request(ctx.app.getHttpServer())
      .put(`/api/v1/technicians/${ctx.technician.id}/skills`)
      .set('Authorization', `Bearer ${ctx.admin.token}`)
      .send({ serviceIds: [], role: 'ADMIN' })
      .expect(400);
    await available({ start: new Date(0).toISOString() }).expect(400);
    await available({
      end: new Date(Date.now() + 2 * 86400000).toISOString(),
    }).expect(400);
    await available({ serviceId: randomUUID() }).expect(404);
  });
  it('filters suspended/deleted technicians and deleted services, with consistent pagination', async () => {
    await skills([ctx.service.id]).expect(200);
    const page = await available({ page: 1, limit: 1 }).expect(200);
    expect(page.body.data.pagination.total).toBeGreaterThanOrEqual(1);
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'SUSPENDED' },
    });
    expect((await available().expect(200)).body.data.items).not.toContainEqual({
      id: ctx.technician.id,
      name: 'Request Fixture',
    });
    await ctx.prisma.user.update({
      where: { id: ctx.technician.id },
      data: { status: 'ACTIVE', deletedAt: new Date() },
    });
    await skills([]).expect(404);
    await ctx.prisma.service.update({
      where: { id: ctx.service.id },
      data: { deletedAt: new Date() },
    });
    await available().expect(404);
  });
  it('protects skills needed by active work and allows adjacency', async () => {
    await skills([ctx.service.id]).expect(200);
    const req = await createOwnedRequest(ctx);
    const dates = window();
    await ctx.prisma.workOrder.create({
      data: {
        requestId: req.id,
        technicianId: ctx.technician.id,
        scheduledStart: new Date(dates.start),
        scheduledEnd: new Date(dates.end),
        agreedPriceMinor: 150000,
      },
    });
    await skills([]).expect(409);
    expect(
      (await available(dates).expect(200)).body.data.items,
    ).not.toContainEqual({ id: ctx.technician.id, name: 'Request Fixture' });
    const adjacent = {
      start: dates.end,
      end: new Date(new Date(dates.end).getTime() + 3600000).toISOString(),
    };
    expect(
      (await available(adjacent).expect(200)).body.data.items,
    ).toContainEqual({ id: ctx.technician.id, name: 'Request Fixture' });
  });
  it('rolls back skill replacement when its audit fails', async () => {
    await skills([ctx.service.id]).expect(200);
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Fixture audit failure'),
    );
    await skills([]).expect(500);
    expect(
      await ctx.prisma.technicianSkill.count({
        where: { userId: ctx.technician.id },
      }),
    ).toBe(1);
  });
  it('concurrent replacements commit a complete set rather than a union', async () => {
    const results = await Promise.all([skills([ctx.service.id]), skills([])]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const stored = await ctx.prisma.technicianSkill.findMany({
      where: { userId: ctx.technician.id },
    });
    expect(stored.length).toBeLessThanOrEqual(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          entityId: ctx.technician.id,
          action: 'TECHNICIAN_SKILLS_UPDATED',
        },
      }),
    ).toBe(2);
  });
});
