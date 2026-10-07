import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/config/app.config.js';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';
import { hashPassword } from '../dist/common/security/password.js';

const testUrl = process.env.TEST_DATABASE_URL;
assert(testUrl, 'Set TEST_DATABASE_URL before compiled smoke tests');
const test = new URL(testUrl);
const main = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : undefined;
assert(
  ['postgres:', 'postgresql:'].includes(test.protocol) &&
    test.pathname.endsWith('_test') &&
    !(
      main &&
      main.hostname === test.hostname &&
      (main.port || '5432') === (test.port || '5432') &&
      main.pathname === test.pathname
    ),
  'Compiled tests require a separate PostgreSQL database ending in _test',
);
const redis = process.env.TEST_REDIS_URL;
if (redis) {
  const url = new URL(redis);
  assert(
    ['redis:', 'rediss:'].includes(url.protocol) &&
      /^\/[1-9]\d*$/.test(url.pathname),
    'TEST_REDIS_URL must use a separate Redis database index greater than zero',
  );
}
process.env.DATABASE_URL = testUrl;
process.env.REDIS_URL = redis ?? '';
process.env.NODE_ENV = 'test';

const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);
const prisma = app.get(PrismaService);
const tag = randomUUID();
const emails = ['owner', 'other', 'admin'].map(
  (name) => `compiled-${name}-${tag}@example.com`,
);
const password = `temporary compiled passphrase ${randomUUID()}`;
let serviceId;
try {
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  async function call(path, status, { method = 'GET', body, token } = {}) {
    const response = await fetch(base + path, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(
      response.status,
      status,
      `Unexpected HTTP status for ${method} ${path}`,
    );
    if (path.startsWith('/requests'))
      assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).data;
  }

  for (const email of emails.slice(0, 2)) {
    await call('/auth/register', 201, {
      method: 'POST',
      body: { email, password, name: 'Compiled Customer' },
    });
  }
  await prisma.user.create({
    data: {
      email: emails[2],
      name: 'Compiled Admin',
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
    },
  });
  const login = async (email) =>
    (
      await call('/auth/login', 200, {
        method: 'POST',
        body: { email, password },
      })
    ).accessToken;
  const customer = await login(emails[0]);
  const other = await login(emails[1]);
  const admin = await login(emails[2]);
  const service = await call('/services', 201, {
    method: 'POST',
    token: admin,
    body: {
      name: `Compiled ${tag}`,
      description: 'Compiled request workflow service.',
      basePriceMinor: 150000,
    },
  });
  serviceId = service.id;
  const created = await call('/requests', 201, {
    method: 'POST',
    token: customer,
    body: {
      serviceId,
      description: 'The cooling unit needs inspection.',
      address: 'House 12, Road 3, Dhaka',
      preferredStart: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  const path = `/requests/${created.id}`;
  await call(path, 404, { token: other });
  assert.equal(
    (await call(`/requests?serviceId=${serviceId}`, 200, { token: customer }))
      .pagination.total,
    1,
  );
  const edited = await call(path, 200, {
    method: 'PATCH',
    token: customer,
    body: { version: 1, address: 'House 25, Road 4, Dhaka' },
  });
  assert.equal(edited.version, 2);
  await call(`${path}/review`, 409, {
    method: 'PATCH',
    token: admin,
    body: { version: 1, decision: 'APPROVE' },
  });
  const approved = await call(`${path}/review`, 200, {
    method: 'PATCH',
    token: admin,
    body: { version: 2, decision: 'APPROVE' },
  });
  assert.equal(approved.status, 'APPROVED');
  const cancelled = await call(`${path}/cancel`, 200, {
    method: 'POST',
    token: customer,
    body: { version: 3, reason: 'Plans have changed' },
  });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.version, 4);
  assert.equal(
    await prisma.auditLog.count({ where: { entityId: created.id } }),
    4,
  );
  console.log(
    'Compiled HTTP workflow passed: authentication, ownership, request lifecycle, versions and audit',
  );
} finally {
  await prisma
    .$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      await tx.serviceRequest.deleteMany({
        where: { customerId: { in: ids } },
      });
      await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await tx.refreshToken.deleteMany({
        where: { session: { userId: { in: ids } } },
      });
      await tx.session.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      if (serviceId) {
        await tx.service.delete({ where: { id: serviceId } });
        await tx.catalogRevision.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        });
      }
    })
    .finally(() => app.close());
}
