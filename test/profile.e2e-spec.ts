import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import type { AuthActor } from '../src/modules/auth/auth.types.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Own profile updates (e2e)', () => {
  let api: TestApi;
  let email: string;
  let accessToken: string;
  let actor: AuthActor;
  const password = 'profile integration passphrase';
  const phone = '+8801712345678';

  beforeEach(async () => {
    email = `profile-${randomUUID()}@example.com`;
    api = await createTestApi();
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Profile Customer', email, password })
      .expect(201);
    const tokens = (
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.data;
    accessToken = tokens.accessToken;
    const session = await api.prisma.session.findFirstOrThrow({
      where: { user: { email } },
    });
    actor = (await api.app
      .get(SessionsService)
      .findActive(session.id, tokens.user.id))!;
  });
  afterEach(async () => {
    try {
      await closeTestApi(api, email);
    } finally {
      vi.restoreAllMocks();
    }
  });

  const patch = (body: object, suffix = '') =>
    request(api.app.getHttpServer())
      .patch(`/api/v1/users/me${suffix}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  const get = () =>
    request(api.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
  const auditCount = () =>
    api.prisma.auditLog.count({ where: { actorId: actor.user.id } });

  it.each(['CUSTOMER', 'TECHNICIAN', 'ADMIN'] as const)(
    'updates a safe own profile and records only field names for %s',
    async (role) => {
      await api.prisma.user.update({ where: { email }, data: { role } });
      const response = await patch({
        name: '  Updated Customer  ',
        phone: ` ${phone} `,
      })
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toEqual({
        success: true,
        message: 'Profile updated successfully',
        data: {
          id: actor.user.id,
          name: 'Updated Customer',
          avatarUrl: null,
          email,
          role,
          phone,
          createdAt: actor.user.createdAt.toISOString(),
        },
      });
      expect((await get().expect(200)).body.data).toEqual(response.body.data);
      const audit = await api.prisma.auditLog.findFirstOrThrow({
        where: { actorId: actor.user.id },
      });
      expect(audit).toMatchObject({
        actorId: actor.user.id,
        action: 'USER_PROFILE_UPDATED',
        entityType: 'USER',
        entityId: actor.user.id,
        metadata: { updatedFields: ['name', 'phone'] },
      });
      expect(JSON.stringify(audit.metadata)).not.toContain(phone);
      expect(JSON.stringify(audit.metadata)).not.toContain('Updated Customer');
      const stored = await api.prisma.user.findUniqueOrThrow({
        where: { email },
      });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.role).toBe(role);
      expect(stored.status).toBe('ACTIVE');
    },
  );

  it('preserves omitted fields, permits clearing a phone and does not log private values', async () => {
    await patch({ phone }).expect(200);
    const nameOnly = (await patch({ name: 'Name Only' }).expect(200)).body.data;
    expect(nameOnly.phone).toBe(phone);
    const cleared = (await patch({ phone: null }).expect(200)).body.data;
    expect(cleared).toMatchObject({ name: 'Name Only', phone: null });
    const audits = await api.prisma.auditLog.findMany({
      where: { actorId: actor.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((log) => log.metadata)).toEqual([
      { updatedFields: ['phone'] },
      { updatedFields: ['name'] },
      { updatedFields: ['phone'] },
    ]);
  });

  it.each([
    {},
    { name: ' ' },
    { name: 'a' },
    { name: 'a'.repeat(101) },
    { name: null },
    { phone: '' },
    { phone: '01712345678' },
    { phone: '+0' },
    { phone: '+1234567890123456' },
    { phone: '+880 1712345678' },
    { phone: 1712345678 },
    { role: 'ADMIN' },
    { status: 'SUSPENDED' },
    { email: 'other@example.com' },
    { password: 'another passphrase' },
    { passwordHash: 'injected' },
    { userId: randomUUID() },
    { name: 'Valid Name', deletedAt: new Date().toISOString() },
  ])('rejects invalid/privileged input without writes: %j', async (body) => {
    await patch(body).expect(400).expect('Cache-Control', 'no-store');
    const stored = await api.prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(stored).toMatchObject({
      name: 'Profile Customer',
      phone: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      deletedAt: null,
    });
    expect(await auditCount()).toBe(0);
  });

  it('always updates the authenticated owner even when a query points at another account', async () => {
    const otherEmail = `other-${email}`;
    await api.prisma.user.create({
      data: { name: 'Other Customer', email: otherEmail },
    });
    try {
      const other = await api.prisma.user.findUniqueOrThrow({
        where: { email: otherEmail },
      });
      await patch({ name: 'Own Name' }, `?userId=${other.id}`).expect(200);
      expect(
        (
          await api.prisma.user.findUniqueOrThrow({
            where: { email: otherEmail },
          })
        ).name,
      ).toBe('Other Customer');
      expect((await get().expect(200)).body.data.name).toBe('Own Name');
      expect(
        await api.prisma.auditLog.count({ where: { entityId: other.id } }),
      ).toBe(0);
    } finally {
      await api.prisma.user.delete({ where: { email: otherEmail } });
    }
  });

  it('preserves independent fields during simultaneous updates and audits both writes', async () => {
    const responses = await Promise.all([
      patch({ name: 'Parallel Name' }),
      patch({ phone }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await get().expect(200)).body.data).toMatchObject({
      name: 'Parallel Name',
      phone,
    });
    expect(await auditCount()).toBe(2);
  });

  it('rolls back the actual profile write when audit persistence fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(api.app.get(AuditService), 'record').mockRejectedValueOnce(
      new Error('Simulated audit storage failure'),
    );
    await patch({ name: 'Must Roll Back', phone }).expect(500);
    expect((await get().expect(200)).body.data).toMatchObject({
      name: 'Profile Customer',
      phone: null,
    });
    expect(await auditCount()).toBe(0);
    await patch({ name: 'Retry Works' }).expect(200);
    expect(await auditCount()).toBe(1);
  });

  it.each(['suspended', 'deleted', 'revoked', 'expired'])(
    'rejects %s accounts/sessions at both the guard and write boundary',
    async (scenario) => {
      if (scenario === 'suspended')
        await api.prisma.user.update({
          where: { email },
          data: { status: 'SUSPENDED' },
        });
      if (scenario === 'deleted')
        await api.prisma.user.update({
          where: { email },
          data: { deletedAt: new Date() },
        });
      if (scenario === 'revoked')
        await api.prisma.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date() },
        });
      if (scenario === 'expired')
        await api.prisma.session.update({
          where: { id: actor.sessionId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      await patch({ name: 'Blocked Update' }).expect(401);
      await expect(
        api.app
          .get(UsersService)
          .updateOwnProfile(actor, { name: 'Blocked Update' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(
        (await api.prisma.user.findUniqueOrThrow({ where: { email } })).name,
      ).toBe('Profile Customer');
      expect(await auditCount()).toBe(0);
    },
  );

  it('requires authentication before accepting a profile body', async () => {
    await request(api.app.getHttpServer())
      .patch('/api/v1/users/me')
      .send({ name: 'Anonymous Update' })
      .expect(401);
    await request(api.app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer invalid')
      .send({ name: 'Invalid Update' })
      .expect(401);
    expect(await auditCount()).toBe(0);
  });
});
