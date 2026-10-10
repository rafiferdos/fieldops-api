import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/common/audit/audit.service.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import { TokensService } from '../src/modules/auth/tokens.service.js';
import { publicUserSelect } from '../src/modules/users/users.select.js';
import {
  createRequestContext,
  closeRequestContext,
  type RequestContext,
} from './helpers/requests.js';
import {
  approvedRequest,
  assignRequest,
  assignedOrder,
  grantSkill,
} from './helpers/scheduling.js';

describe('Administrator account management (e2e)', () => {
  let ctx: RequestContext;
  beforeEach(async () => {
    ctx = await createRequestContext();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeRequestContext(ctx);
  });
  const patch = (id: string, body: object, token = ctx.admin.token) =>
    request(ctx.app.getHttpServer())
      .patch(`/api/v1/admin/users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const profile = (token: string) =>
    request(ctx.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

  async function newSession(id: string) {
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id },
      select: publicUserSelect,
    });
    const session = await ctx.prisma.$transaction((tx) =>
      ctx.app.get(SessionsService).createInTransaction(tx, user),
    );
    return ctx.app.get(TokensService).issue(session);
  }

  it('validates the strict access contract and restricts it to ADMIN', async () => {
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/admin/users/${ctx.owner.id}`)
      .send({ status: 'SUSPENDED' })
      .expect(401);
    await patch(ctx.other.id, { role: 'ADMIN' }, ctx.owner.token).expect(403);
    await patch(ctx.other.id, { role: 'ADMIN' }, ctx.technician.token).expect(
      403,
    );
    for (const body of [
      {},
      { role: 'MANAGER' },
      { status: 'DELETED' },
      { role: 'ADMIN', passwordHash: 'forbidden' },
    ])
      await patch(ctx.owner.id, body).expect(400);
    await patch('invalid', { role: 'TECHNICIAN' }).expect(400);
    await patch(randomUUID(), { role: 'TECHNICIAN' }).expect(404);
    await ctx.prisma.user.update({
      where: { id: ctx.other.id },
      data: { deletedAt: new Date() },
    });
    await patch(ctx.other.id, { role: 'TECHNICIAN' }).expect(404);
  });

  it('changes access atomically, revokes every session and exposes only safe user fields', async () => {
    const extra = await newSession(ctx.owner.id);
    const response = await patch(ctx.owner.id, { role: 'TECHNICIAN' }).expect(
      200,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      id: ctx.owner.id,
      role: 'TECHNICIAN',
      status: 'ACTIVE',
    });
    expect(Object.keys(response.body.data).sort()).toEqual(
      [
        'avatarUrl',
        'id',
        'name',
        'email',
        'role',
        'status',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    await profile(ctx.owner.token).expect(401);
    await profile(extra.accessToken).expect(401);
    await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: extra.refreshToken })
      .expect(401);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'USER_ACCESS_UPDATED', entityId: ctx.owner.id },
    });
    expect(audit.metadata).toEqual({
      previousRole: 'CUSTOMER',
      role: 'TECHNICIAN',
      previousStatus: 'ACTIVE',
      status: 'ACTIVE',
    });
  });

  it('suspends and reactivates without reviving any old session', async () => {
    await patch(ctx.owner.id, { status: 'SUSPENDED' }).expect(200);
    await profile(ctx.owner.token).expect(401);
    await patch(ctx.owner.id, { status: 'ACTIVE' }).expect(200);
    await profile(ctx.owner.token).expect(401);
    await profile((await newSession(ctx.owner.id)).accessToken).expect(200);
  });

  it('rechecks stale login state before issuing a new session', async () => {
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.owner.id },
      select: publicUserSelect,
    });
    await patch(ctx.owner.id, { role: 'TECHNICIAN' }).expect(200);
    const session = await ctx.prisma.$transaction((tx) =>
      ctx.app.get(SessionsService).createInTransaction(tx, user),
    );
    expect(session.user.role).toBe('TECHNICIAN');
    await patch(ctx.owner.id, { status: 'SUSPENDED' }).expect(200);
    await expect(
      ctx.prisma.$transaction((tx) =>
        ctx.app.get(SessionsService).createInTransaction(tx, user),
      ),
    ).rejects.toThrow('Account is unavailable');
    expect(
      await ctx.prisma.session.count({
        where: { userId: ctx.owner.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('does not leave a usable session when login creation races suspension', async () => {
    for (let i = 0; i < 5; i++) {
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ctx.owner.id },
        select: publicUserSelect,
      });
      const [login, change] = await Promise.allSettled([
        ctx.prisma.$transaction((tx) =>
          ctx.app.get(SessionsService).createInTransaction(tx, user),
        ),
        patch(ctx.owner.id, { status: 'SUSPENDED' }).expect(200),
      ]);
      expect(change.status).toBe('fulfilled');
      if (login.status === 'rejected')
        expect(login.reason.message).toBe('Account is unavailable');
      expect(
        await ctx.prisma.session.count({
          where: { userId: ctx.owner.id, revokedAt: null },
        }),
      ).toBe(0);
      await patch(ctx.owner.id, { status: 'ACTIVE' }).expect(200);
      if (login.status === 'fulfilled') {
        const token = await ctx.app.get(TokensService).issue(login.value);
        await profile(token.accessToken).expect(401);
      }
    }
  });

  it('treats unchanged access as a no-op without audit or session revocation', async () => {
    await patch(ctx.owner.id, { role: 'CUSTOMER', status: 'ACTIVE' }).expect(
      200,
    );
    await profile(ctx.owner.token).expect(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'USER_ACCESS_UPDATED', entityId: ctx.owner.id },
      }),
    ).toBe(0);
  });

  it('protects the last active administrator from suspension and demotion', async () => {
    expect(
      await ctx.prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      }),
    ).toBe(1);
    await patch(ctx.admin.id, { status: 'SUSPENDED' }).expect(409);
    await patch(ctx.admin.id, { role: 'CUSTOMER' }).expect(409);
    await profile(ctx.admin.token).expect(200);
  });

  it('retains an active administrator when two administrators concurrently suspend themselves', async () => {
    await patch(ctx.other.id, { role: 'ADMIN' }).expect(200);
    const other = await newSession(ctx.other.id);
    const results = await Promise.all([
      patch(ctx.admin.id, { status: 'SUSPENDED' }),
      patch(ctx.other.id, { status: 'SUSPENDED' }, other.accessToken),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(
      await ctx.prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      }),
    ).toBe(1);
  });

  it('blocks role changes with active work and removes obsolete skills after an idle role change', async () => {
    await assignedOrder(ctx);
    await patch(ctx.technician.id, { role: 'CUSTOMER' }).expect(409);
    expect(
      await ctx.prisma.technicianSkill.count({
        where: { userId: ctx.technician.id },
      }),
    ).toBe(1);
    await patch(ctx.other.id, { role: 'TECHNICIAN' }).expect(200);
    await ctx.prisma.technicianSkill.create({
      data: { userId: ctx.other.id, serviceId: ctx.service.id },
    });
    await patch(ctx.other.id, { role: 'CUSTOMER' }).expect(200);
    expect(
      await ctx.prisma.technicianSkill.count({
        where: { userId: ctx.other.id },
      }),
    ).toBe(0);
  });

  it('serializes assignment against a concurrent technician role change', async () => {
    await grantSkill(ctx);
    const pending = await approvedRequest(ctx);
    const [change, assignment] = await Promise.all([
      patch(ctx.technician.id, { role: 'CUSTOMER' }),
      assignRequest(ctx, pending.id),
    ]);
    expect([
      [200, 404],
      [200, 409],
      [409, 201],
    ]).toContainEqual([change.status, assignment.status]);
    const work = await ctx.prisma.workOrder.findUnique({
      where: { requestId: pending.id },
    });
    const technician = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.technician.id },
    });
    if (work) expect(technician.role).toBe('TECHNICIAN');
    else expect(technician.role).toBe('CUSTOMER');
  });

  it('rolls back role, skills and revocations if the audit write fails', async () => {
    await grantSkill(ctx);
    vi.spyOn(ctx.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Injected audit outage'),
    );
    await patch(ctx.technician.id, { role: 'CUSTOMER' }).expect(500);
    expect(
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: ctx.technician.id },
        })
      ).role,
    ).toBe('TECHNICIAN');
    expect(
      await ctx.prisma.technicianSkill.count({
        where: { userId: ctx.technician.id },
      }),
    ).toBe(1);
    await profile(ctx.technician.token).expect(200);
  });
});
