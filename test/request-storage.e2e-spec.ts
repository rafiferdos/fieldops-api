import { randomUUID } from 'node:crypto';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Request persistence invariants (e2e)', () => {
  let api: TestApi;
  let customerId: string;
  let serviceId: string;
  const email = `request-storage-${randomUUID()}@example.com`;
  beforeAll(async () => {
    api = await createTestApi();
    const customer = await api.prisma.user.create({
      data: { email, name: 'Request Storage Customer' },
    });
    customerId = customer.id;
    const service = await api.prisma.$transaction(async (tx) => {
      const row = await tx.service.create({
        data: {
          name: 'Storage Service',
          description: 'Request storage constraint fixture.',
          basePriceMinor: 1000,
        },
      });
      await tx.catalogRevision.update({
        where: { id: 1 },
        data: { revision: { increment: 1 } },
      });
      return row;
    });
    serviceId = service.id;
  });
  afterEach(async () => {
    await api.prisma.serviceRequest.deleteMany({ where: { customerId } });
  });
  afterAll(async () => {
    try {
      await api.prisma.$transaction(async (tx) => {
        await tx.service.delete({ where: { id: serviceId } });
        await tx.catalogRevision.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        });
      });
    } finally {
      await closeTestApi(api, email);
    }
  });
  const data = () => ({
    customerId,
    serviceId,
    description: 'Inspect the cooling unit.',
    address: 'House 12, Road 3, Dhaka',
    preferredStart: new Date(Date.now() + 86400000),
  });

  it('defaults to pending version one and preserves referenced user/service history', async () => {
    const stored = await api.prisma.serviceRequest.create({ data: data() });
    expect(stored).toMatchObject({
      status: 'PENDING',
      version: 1,
      deletedAt: null,
      reviewedAt: null,
      cancelledAt: null,
    });
    await expect(
      api.prisma.user.delete({ where: { id: customerId } }),
    ).rejects.toThrow();
    await expect(
      api.prisma.service.delete({ where: { id: serviceId } }),
    ).rejects.toThrow();
  });

  it.each([
    { version: 0 },
    { version: -1 },
    { description: 'short' },
    { address: '   ' },
    { status: 'APPROVED' as const },
    { status: 'REJECTED' as const, reviewedAt: new Date() },
    { status: 'CANCELLED' as const },
    { reviewedAt: new Date() },
    { cancellationReason: 'Cannot attend', cancelledAt: new Date() },
  ])('rejects inconsistent direct writes: %j', async (override) => {
    await expect(
      api.prisma.serviceRequest.create({ data: { ...data(), ...override } }),
    ).rejects.toThrow();
  });
});
