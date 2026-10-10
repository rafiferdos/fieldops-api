import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import type { AuthActor } from '../src/modules/auth/auth.types.js';
import { ServicesService } from '../src/modules/services/services.service.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Admin service catalog (e2e)', () => {
  let api: TestApi;
  let email: string;
  let token: string;
  let actor: AuthActor;
  const ids: string[] = [];
  const input = {
    name: 'AC Maintenance',
    description: 'Inspect and clean the air conditioner.',
    basePriceMinor: 150000,
  };

  beforeEach(async () => {
    api = await createTestApi();
    email = `catalog-admin-${randomUUID()}@example.com`;
    const password = 'catalog integration passphrase';
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Catalog Admin', email, password })
      .expect(201);
    await api.prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const credentials = (
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.data;
    token = credentials.accessToken;
    const session = await api.prisma.session.findFirstOrThrow({
      where: { user: { email } },
    });
    actor = (await api.app
      .get(SessionsService)
      .findActive(session.id, credentials.user.id))!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await api.prisma.$transaction(async (tx) => {
        await tx.service.deleteMany({ where: { id: { in: ids } } });
        await tx.catalogRevision.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        });
      });
      ids.length = 0;
    } finally {
      await closeTestApi(api, email);
    }
  });

  const post = (body: object = input) =>
    request(api.app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const patch = (id: string, body: object) =>
    request(api.app.getHttpServer())
      .patch(`/api/v1/services/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const remove = (id: string) =>
    request(api.app.getHttpServer())
      .delete(`/api/v1/services/${id}`)
      .set('Authorization', `Bearer ${token}`);
  async function create() {
    const response = await post().expect(201);
    ids.push(response.body.data.id);
    return response.body.data as { id: string };
  }
  const audits = (id: string) =>
    api.prisma.auditLog.findMany({ where: { entityId: id } });

  it('creates fixed-BDT service, updates snapshots and soft deletes with atomic audits', async () => {
    const created = await post({ ...input, name: '  AC Maintenance  ' }).expect(
      201,
    );
    const id = created.body.data.id;
    ids.push(id);
    expect(created.body.data).toEqual({
      ...input,
      imageUrl: null,
      id,
      currency: 'BDT',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const updated = await patch(id, { basePriceMinor: 0 }).expect(200);
    expect(updated.body.data).toMatchObject({
      ...input,
      id,
      basePriceMinor: 0,
    });
    await remove(id)
      .expect(200)
      .expect(({ body }) => expect(body.data).toBeNull());
    expect(
      (await api.prisma.service.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).toBeInstanceOf(Date);
    const events = await audits(id);
    expect(events.map((event) => event.action).sort()).toEqual([
      'SERVICE_CREATED',
      'SERVICE_DELETED',
      'SERVICE_UPDATED',
    ]);
    expect(
      events.find((event) => event.action === 'SERVICE_UPDATED')?.metadata,
    ).toEqual({
      updatedFields: ['basePriceMinor'],
      previousBasePriceMinor: input.basePriceMinor,
      basePriceMinor: 0,
    });
    await patch(id, { name: 'After Delete' }).expect(404);
    await remove(id).expect(404);
    expect(await audits(id)).toHaveLength(3);
  });

  it.each(['CUSTOMER', 'TECHNICIAN'] as const)(
    'denies all writes for %s, including a stale actor',
    async (role) => {
      const { id } = await create();
      await api.prisma.user.update({ where: { email }, data: { role } });
      await post().expect(403);
      await patch(id, { name: 'Blocked Name' }).expect(403);
      await remove(id).expect(403);
      await expect(
        api.app.get(ServicesService).create(actor, input),
      ).rejects.toMatchObject({ status: 403 });
      expect(await audits(id)).toHaveLength(1);
    },
  );

  it.each([
    { ...input, basePriceMinor: -1 },
    { ...input, basePriceMinor: 1.5 },
    { ...input, basePriceMinor: '100' },
    { ...input, basePriceMinor: 1000000001 },
    { ...input, currency: 'USD' },
    { ...input, deletedAt: null },
    { ...input, name: ' ' },
    { ...input, description: 'short' },
  ])('rejects invalid or privileged create input: %j', async (body) => {
    await post(body).expect(400);
    expect(
      await api.prisma.auditLog.count({ where: { actorId: actor.user.id } }),
    ).toBe(0);
  });

  it('rejects empty/extra updates and malformed/missing identifiers', async () => {
    const { id } = await create();
    await patch(id, {}).expect(400);
    await patch(id, { currency: 'BDT' }).expect(400);
    await patch('invalid', { name: 'Valid Name' }).expect(400);
    await remove('invalid').expect(400);
    await patch(randomUUID(), { name: 'Missing Service' }).expect(404);
    await remove(randomUUID()).expect(404);
    expect(await audits(id)).toHaveLength(1);
  });

  it('serializes concurrent price changes with accurate prior-price snapshots', async () => {
    const { id } = await create();
    const responses = await Promise.all([
      patch(id, { basePriceMinor: 200000 }),
      patch(id, { basePriceMinor: 300000 }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const events = (await audits(id)).filter(
      (event) => event.action === 'SERVICE_UPDATED',
    );
    const first = events.find(
      (event) =>
        (event.metadata as { previousBasePriceMinor: number })
          .previousBasePriceMinor === input.basePriceMinor,
    )!;
    const second = events.find((event) => event.id !== first.id)!;
    expect(
      (second.metadata as { previousBasePriceMinor: number })
        .previousBasePriceMinor,
    ).toBe((first.metadata as { basePriceMinor: number }).basePriceMinor);
    expect(
      (await api.prisma.service.findUniqueOrThrow({ where: { id } }))
        .basePriceMinor,
    ).toBe((second.metadata as { basePriceMinor: number }).basePriceMinor);
  });

  it('preserves independent concurrent edits and handles delete/update races', async () => {
    const { id } = await create();
    const edits = await Promise.all([
      patch(id, { name: 'New Name' }),
      patch(id, { description: 'New detailed description.' }),
    ]);
    expect(edits.map((response) => response.status)).toEqual([200, 200]);
    expect(
      await api.prisma.service.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      name: 'New Name',
      description: 'New detailed description.',
    });
    const [deleted, edited] = await Promise.all([
      remove(id),
      patch(id, { name: 'Race Name' }),
    ]);
    expect(deleted.status).toBe(200);
    expect([200, 404]).toContain(edited.status);
    expect(
      (await api.prisma.service.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).not.toBeNull();
    expect(await audits(id)).toHaveLength(edited.status === 200 ? 5 : 4);
  });

  it('rolls back create/update/delete when audit persistence fails', async () => {
    const { id } = await create();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const audit = vi.spyOn(api.app.get(AuditService), 'record');
    audit.mockRejectedValueOnce(new Error('Audit unavailable'));
    await post({ ...input, name: email }).expect(500);
    expect(await api.prisma.service.count({ where: { name: email } })).toBe(0);
    audit.mockRejectedValueOnce(new Error('Audit unavailable'));
    await patch(id, { basePriceMinor: 1 }).expect(500);
    audit.mockRejectedValueOnce(new Error('Audit unavailable'));
    await remove(id).expect(500);
    expect(
      await api.prisma.service.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ basePriceMinor: input.basePriceMinor, deletedAt: null });
    expect(await audits(id)).toHaveLength(1);
  });

  it.each(['suspended', 'deleted', 'revoked', 'expired'])(
    'denies %s accounts/sessions at the write boundary',
    async (state) => {
      if (state === 'suspended')
        await api.prisma.user.update({
          where: { email },
          data: { status: 'SUSPENDED' },
        });
      if (state === 'deleted')
        await api.prisma.user.update({
          where: { email },
          data: { deletedAt: new Date() },
        });
      if (state === 'revoked')
        await api.prisma.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date() },
        });
      if (state === 'expired')
        await api.prisma.session.update({
          where: { id: actor.sessionId },
          data: { expiresAt: new Date(0) },
        });
      await post().expect(401);
      await expect(
        api.app.get(ServicesService).create(actor, input),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it('requires authentication for every mutation', async () => {
    const server = api.app.getHttpServer();
    await request(server).post('/api/v1/services').send(input).expect(401);
    await request(server)
      .patch(`/api/v1/services/${randomUUID()}`)
      .send({ name: 'Anonymous' })
      .expect(401);
    await request(server)
      .delete(`/api/v1/services/${randomUUID()}`)
      .expect(401);
  });
});
