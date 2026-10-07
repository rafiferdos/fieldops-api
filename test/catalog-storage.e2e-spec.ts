import { randomUUID } from 'node:crypto';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Catalog database constraints (e2e)', () => {
  let api: TestApi;
  const ids: string[] = [];
  beforeEach(async () => {
    api = await createTestApi();
  });
  afterEach(async () => {
    try {
      if (ids.length)
        await api.prisma.$transaction([
          api.prisma.service.deleteMany({
            where: { id: { in: ids.splice(0) } },
          }),
          api.prisma.catalogRevision.update({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
          }),
        ]);
    } finally {
      await closeTestApi(api);
    }
  });

  it.each([-1, 1000000001])(
    'rejects out-of-range money from a writer bypassing HTTP: %s',
    async (basePriceMinor) => {
      await expect(
        api.prisma.service.create({
          data: {
            name: 'Invalid Price',
            description: 'Database constraint test',
            basePriceMinor,
          },
        }),
      ).rejects.toThrow();
    },
  );

  it.each([0, 1000000000])(
    'stores integer price boundaries with BDT and an active default: %s',
    async (basePriceMinor) => {
      const [service] = await api.prisma.$transaction([
        api.prisma.service.create({
          data: {
            name: `Storage ${randomUUID()}`,
            description: 'Database boundary test',
            basePriceMinor,
          },
        }),
        api.prisma.catalogRevision.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        }),
      ]);
      ids.push(service.id);
      expect(service).toMatchObject({
        basePriceMinor,
        currency: 'BDT',
        deletedAt: null,
      });
    },
  );

  it('enforces a singleton nonnegative catalog generation', async () => {
    await expect(
      api.prisma.catalogRevision.create({ data: { id: 2 } }),
    ).rejects.toThrow();
    await expect(
      api.prisma.catalogRevision.update({
        where: { id: 1 },
        data: { revision: -1n },
      }),
    ).rejects.toThrow();
    expect(await api.prisma.catalogRevision.count()).toBe(1);
    expect(
      (await api.prisma.catalogRevision.findUniqueOrThrow({ where: { id: 1 } }))
        .revision,
    ).toBeGreaterThanOrEqual(0n);
  });
});
