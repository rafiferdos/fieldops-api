import { createHash, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { createClient } from 'redis';
import { RedisCacheService } from '../src/infrastructure/cache/redis-cache.service.js';
import { catalogQuerySchema } from '../src/modules/services/schemas/catalog.schema.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Public service catalog (e2e)', () => {
  let api: TestApi;
  let tag: string;
  const ids: string[] = [];

  beforeEach(async () => {
    api = await createTestApi();
    tag = randomUUID();
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
      await closeTestApi(api);
    }
  });
  const list = (query: object = { q: tag }) =>
    request(api.app.getHttpServer()).get('/api/v1/services').query(query);
  const detail = (id: string) =>
    request(api.app.getHttpServer()).get(`/api/v1/services/${id}`);
  async function fixture(name: string, price: number, deleted = false) {
    const service = await api.prisma.$transaction(async (tx) => {
      const row = await tx.service.create({
        data: {
          name,
          description: `Maintenance catalog ${tag}`,
          basePriceMinor: price,
          deletedAt: deleted ? new Date() : null,
        },
      });
      await tx.catalogRevision.update({
        where: { id: 1 },
        data: { revision: { increment: 1 } },
      });
      return row;
    });
    ids.push(service.id);
    return service;
  }

  it('serves anonymous active-only paginated catalog and safe detail projections', async () => {
    const a = await fixture('Alpha Maintenance', 1000);
    await fixture('Beta Maintenance', 2000);
    const deleted = await fixture('Hidden Maintenance', 500, true);
    const response = await list({
      q: tag,
      page: 2,
      limit: 1,
      sort: 'price_asc',
    }).expect(200);
    expect(response.body.data.pagination).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(response.body.data.items[0]).toMatchObject({
      name: 'Beta Maintenance',
      basePriceMinor: 2000,
      currency: 'BDT',
    });
    const own = await detail(a.id).expect(200);
    expect(Object.keys(own.body.data).sort()).toEqual([
      'basePriceMinor',
      'createdAt',
      'currency',
      'description',
      'id',
      'name',
      'updatedAt',
    ]);
    await detail(deleted.id).expect(404);
    await detail(randomUUID()).expect(404);
    await detail('invalid').expect(400);
    expect(
      (await list({ q: tag, page: 3, limit: 1 }).expect(200)).body.data.items,
    ).toEqual([]);
    expect(
      (await list({ q: randomUUID() }).expect(200)).body.data.pagination
        .totalPages,
    ).toBe(0);
  });

  it.each(['newest', 'oldest', 'name_asc', 'price_asc', 'price_desc'] as const)(
    'provides deterministic sorting: %s',
    async (sort) => {
      const a = await fixture('Alpha Catalog', 1000);
      const b = await fixture('Beta Catalog', 2000);
      const sameTime = new Date('2026-01-01T00:00:00.000Z');
      await api.prisma.$transaction(async (tx) => {
        await tx.service.updateMany({
          where: { id: { in: [a.id, b.id] } },
          data: { createdAt: sameTime },
        });
        await tx.catalogRevision.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        });
      });
      const response = await list({ q: tag, sort }).expect(200);
      const expected =
        sort === 'price_desc'
          ? [b.id, a.id]
          : sort === 'newest' || sort === 'oldest'
            ? [a.id, b.id].sort()
            : [a.id, b.id];
      expect(
        response.body.data.items.map((item: { id: string }) => item.id),
      ).toEqual(expected);
    },
  );

  it.each(['%', '_', '\\'])(
    'searches literal LIKE metacharacters: %s',
    async (character) => {
      const matching = await fixture(`Special ${character} ${tag}`, 1000);
      await fixture(`Normal ${tag}`, 1000);
      const response = await list({ q: `${character} ${tag}` }).expect(200);
      expect(
        response.body.data.items.map((item: { id: string }) => item.id),
      ).toEqual([matching.id]);
    },
  );

  it('trims and searches descriptions case-insensitively', async () => {
    const service = await fixture('Mixed Case', 1000);
    const response = await list({ q: `  MAINTENANCE CATALOG ${tag}  ` }).expect(
      200,
    );
    expect(
      response.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([service.id]);
  });

  it.each([
    { page: 0 },
    { page: 100001 },
    { page: 1.5 },
    { limit: 0 },
    { limit: 101 },
    { sort: 'invalid' },
    { q: 'a'.repeat(101) },
    { deletedAt: 'null' },
    { page: ['1', '2'] },
  ])('rejects invalid/extra queries: %j', async (query) => {
    await list(query).expect(400);
  });
});

describe.skipIf(!process.env.TEST_REDIS_URL)(
  'Real Redis catalog reliability (e2e)',
  () => {
    let api: TestApi;
    let redis: ReturnType<typeof createClient>;
    let email: string;
    let token: string;
    let id: string;
    const ownedKeys = new Set<string>();
    const serviceIds = new Set<string>();

    beforeEach(async () => {
      api = await createTestApi();
      redis = createClient({ url: process.env.TEST_REDIS_URL });
      redis.on('error', () => {});
      await redis.connect();
      email = `redis-admin-${randomUUID()}@example.com`;
      const password = 'redis catalog test passphrase';
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'Redis Admin', email, password })
        .expect(201);
      await api.prisma.user.update({
        where: { email },
        data: { role: 'ADMIN' },
      });
      token = (
        await request(api.app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password })
          .expect(200)
      ).body.data.accessToken;
      const created = await request(api.app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: email,
          description: 'Catalog Redis reliability test.',
          basePriceMinor: 1000,
        })
        .expect(201);
      id = created.body.data.id;
      serviceIds.add(id);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      try {
        const listHash = createHash('sha256')
          .update(JSON.stringify(catalogQuerySchema.parse({ q: email })))
          .digest('hex');
        const keys = await redis.keys(`fieldops:*:catalog:*:list:${listHash}`);
        for (const serviceId of serviceIds)
          keys.push(
            ...(await redis.keys(`fieldops:*:catalog:*:detail:${serviceId}`)),
          );
        keys.forEach((key) => ownedKeys.add(key));
        if (ownedKeys.size) await redis.del([...ownedKeys]);
        ownedKeys.clear();
        await api.prisma.$transaction(async (tx) => {
          await tx.service.deleteMany({
            where: { id: { in: [...serviceIds] } },
          });
          await tx.catalogRevision.update({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
          });
        });
      } finally {
        redis.destroy();
        await closeTestApi(api, email);
      }
    });
    const detail = () =>
      request(api.app.getHttpServer()).get(`/api/v1/services/${id}`);
    const update = (body: object) =>
      request(api.app.getHttpServer())
        .patch(`/api/v1/services/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    async function withStableRevision(run: () => Promise<void>) {
      // Keep other fixture writers from changing the global revision during hit assertions.
      await api.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CatalogRevision" WHERE id = 1 FOR UPDATE`;
          await run();
        },
        { timeout: 10000 },
      );
    }

    it('uses real cache hits and TTL; rejects corrupted/non-public data', async () => {
      await withStableRevision(async () => {
        const read = vi.spyOn(api.prisma.service, 'findFirst');
        await detail().expect(200);
        await vi.waitFor(async () => {
          expect(
            (await redis.keys(`fieldops:*:catalog:*:detail:${id}`)).length,
          ).toBeGreaterThan(0);
        });
        read.mockClear();
        const response = await detail().expect(200);
        expect(read).not.toHaveBeenCalled();
        const [key] = await redis.keys(`fieldops:*:catalog:*:detail:${id}`);
        expect(await redis.ttl(key!)).toBeGreaterThan(0);
        expect(await redis.ttl(key!)).toBeLessThanOrEqual(60);
        await redis.set(
          key!,
          JSON.stringify({
            ...response.body.data,
            passwordHash: 'must-never-leak',
          }),
        );
        await detail()
          .expect(200)
          .expect(({ body }) =>
            expect(body.data).not.toHaveProperty('passwordHash'),
          );
        expect(read).toHaveBeenCalledOnce();
        const listRead = vi.spyOn(api.prisma.service, 'findMany');
        const list = () =>
          request(api.app.getHttpServer())
            .get('/api/v1/services')
            .query({ q: email });
        await list().expect(200);
        await list().expect(200);
        expect(listRead).toHaveBeenCalledOnce();
      });
    });

    it('invalidates cached lists/details after writes, including writes during an outage', async () => {
      const list = () =>
        request(api.app.getHttpServer())
          .get('/api/v1/services')
          .query({ q: email });
      await detail().expect(200);
      await list().expect(200);
      const added = await request(api.app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: email,
          description: 'Another matching catalog service.',
          basePriceMinor: 500,
        })
        .expect(201);
      const addedId: string = added.body.data.id;
      serviceIds.add(addedId);
      expect((await list().expect(200)).body.data.pagination.total).toBe(2);
      await request(api.app.getHttpServer())
        .delete(`/api/v1/services/${addedId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((await list().expect(200)).body.data.pagination.total).toBe(1);
      const cache = api.app.get(RedisCacheService);
      const outage = vi
        .spyOn(cache, 'remember')
        .mockImplementation(async (_key, _schema, load) => load());
      await update({ basePriceMinor: 2500 }).expect(200);
      expect((await detail().expect(200)).body.data.basePriceMinor).toBe(2500);
      outage.mockRestore();
      expect((await detail().expect(200)).body.data.basePriceMinor).toBe(2500);
      expect((await list().expect(200)).body.data.items[0].basePriceMinor).toBe(
        2500,
      );
      await request(api.app.getHttpServer())
        .delete(`/api/v1/services/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await detail().expect(404);
      expect((await list().expect(200)).body.data.pagination.total).toBe(0);
    });

    it('does not serve unverified stale data when PostgreSQL cannot supply the revision', async () => {
      await detail().expect(200);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(
        api.prisma.catalogRevision,
        'findUniqueOrThrow',
      ).mockRejectedValueOnce(new Error('Database unavailable'));
      await detail().expect(500);
    });

    it('ignores an old in-flight cache fill after a newer price commits', async () => {
      const cache = api.app.get(RedisCacheService);
      const remember = cache.remember.bind(cache);
      let signalLoaded!: () => void;
      let release!: () => void;
      const loaded = new Promise<void>((resolve) => {
        signalLoaded = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = vi
        .spyOn(cache, 'remember')
        .mockImplementation((key, schema, load) =>
          remember(key, schema, async () => {
            const value = await load();
            signalLoaded();
            await paused;
            return value;
          }),
        );
      const oldRead = detail()
        .expect(200)
        .then((response) => response);
      try {
        await loaded;
        await update({ basePriceMinor: 5000 }).expect(200);
      } finally {
        release();
      }
      expect((await oldRead).body.data.basePriceMinor).toBe(1000);
      delayed.mockRestore();
      expect((await detail().expect(200)).body.data.basePriceMinor).toBe(5000);
    });

    it('falls back to PostgreSQL when Redis is actually disconnected', async () => {
      await detail().expect(200);
      api.app.get(RedisCacheService).onModuleDestroy();
      const read = vi.spyOn(api.prisma.service, 'findFirst');
      const response = await detail().expect(200);
      expect(response.body.data.id).toBe(id);
      expect(read).toHaveBeenCalledOnce();
    });
  },
);
