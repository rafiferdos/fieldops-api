import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Role } from '../../src/generated/prisma/enums.js';
import type { AuthActor } from '../../src/modules/auth/auth.types.js';
import { SessionsService } from '../../src/modules/auth/sessions.service.js';
import { TokensService } from '../../src/modules/auth/tokens.service.js';
import { publicUserSelect } from '../../src/modules/users/users.select.js';
import type { requestView } from '../../src/modules/requests/request.select.js';
import { createTestApi, type TestApi } from './api.js';

type FixtureUser = {
  id: string;
  email: string;
  token: string;
  actor: AuthActor;
};

async function authenticatedFixture(
  api: TestApi,
  role: Role,
): Promise<FixtureUser> {
  // Domain fixtures bypass login setup; HTTP still uses real JWTs, guards and DB sessions.
  const user = await api.prisma.user.create({
    data: {
      name: 'Request Fixture',
      email: `request-${randomUUID()}@example.com`,
      role,
    },
    select: publicUserSelect,
  });
  const session = await api.prisma.$transaction((tx) =>
    api.app.get(SessionsService).createInTransaction(tx, user),
  );
  const tokens = await api.app.get(TokensService).issue(session);
  const actor = (await api.app
    .get(SessionsService)
    .findActive(session.id, user.id))!;
  return { id: user.id, email: user.email, token: tokens.accessToken, actor };
}

export async function createRequestContext() {
  const api = await createTestApi();
  const owner = await authenticatedFixture(api, 'CUSTOMER');
  const other = await authenticatedFixture(api, 'CUSTOMER');
  const admin = await authenticatedFixture(api, 'ADMIN');
  const technician = await authenticatedFixture(api, 'TECHNICIAN');
  const service = await api.prisma.$transaction(async (tx) => {
    const row = await tx.service.create({
      data: {
        name: `Request ${randomUUID()}`,
        description: 'Request domain fixture service.',
        basePriceMinor: 150000,
      },
    });
    await tx.catalogRevision.update({
      where: { id: 1 },
      data: { revision: { increment: 1 } },
    });
    return row;
  });
  return { ...api, owner, other, admin, technician, service };
}
export type RequestContext = Awaited<ReturnType<typeof createRequestContext>>;

export function requestBody(context: RequestContext) {
  return {
    serviceId: context.service.id,
    description: 'The cooling unit needs inspection.',
    address: 'House 12, Road 3, Dhaka',
    preferredStart: new Date(Date.now() + 86400000).toISOString(),
  };
}

export async function createOwnedRequest(
  context: RequestContext,
  user = context.owner,
  overrides: object = {},
) {
  const response = await request(context.app.getHttpServer())
    .post('/api/v1/requests')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ ...requestBody(context), ...overrides })
    .expect(201);
  return response.body.data as ReturnType<typeof requestView>;
}

export async function closeRequestContext(context: RequestContext | undefined) {
  if (!context) return;
  const ids = [
    context.owner,
    context.other,
    context.admin,
    context.technician,
  ].map((user) => user.id);
  try {
    await context.prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({
        where: {
          entityType: 'PAYMENT',
          entityId: {
            in: (
              await tx.payment.findMany({
                where: { userId: { in: ids } },
                select: { id: true },
              })
            ).map((row) => row.id),
          },
        },
      });
      await tx.payment.deleteMany({ where: { userId: { in: ids } } });
      await tx.invoice.deleteMany({ where: { customerId: { in: ids } } });
      await tx.workOrder.deleteMany({
        where: { request: { customerId: { in: ids } } },
      });
      await tx.technicianSkill.deleteMany({ where: { userId: { in: ids } } });
      await tx.serviceRequest.deleteMany({
        where: { customerId: { in: ids } },
      });
      await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await tx.refreshToken.deleteMany({
        where: { session: { userId: { in: ids } } },
      });
      await tx.session.deleteMany({ where: { userId: { in: ids } } });
      await tx.authIdentity.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.service.delete({ where: { id: context.service.id } });
      await tx.catalogRevision.update({
        where: { id: 1 },
        data: { revision: { increment: 1 } },
      });
    });
  } finally {
    await context.app.close();
  }
}
