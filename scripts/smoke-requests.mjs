import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';

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
// Native tests use a fake merchant and replace HTTP transport before any payment request.
process.env.SSLCOMMERZ_MODE = 'sandbox';
process.env.SSLCOMMERZ_STORE_ID = 'compiled-fixture';
process.env.SSLCOMMERZ_STORE_PASSWORD = 'compiled-fixture-password';
process.env.PUBLIC_API_URL = 'https://api.example.com';

// ConfigModule validates at module evaluation time. Select the test DB BEFORE importing it.
const { AppModule } = await import('../dist/app.module.js');
const { configureApp } = await import('../dist/config/app.config.js');
const { GatewayHttpService } =
  await import('../dist/infrastructure/sslcommerz/gateway-http.service.js');
const { PrismaService } =
  await import('../dist/infrastructure/prisma/prisma.service.js');

const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);
const prisma = app.get(PrismaService);
const tag = randomUUID().replaceAll('-', '').slice(0, 12);
const emails = ['owner', 'other', 'admin', 'technician'].map(
  (name) => `compiled-${name}-${tag}@example.com`,
);
const password = `temporary compiled passphrase ${randomUUID()}`;
let serviceId;
try {
  const [{ database }] =
    await prisma.$queryRaw`SELECT current_database() AS database`;
  assert.equal(
    database,
    decodeURIComponent(test.pathname.slice(1)),
    'Compiled app must use the selected test database',
  );
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  async function call(
    path,
    status,
    { method = 'GET', body, token, headers = {} } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(
      response.status,
      status,
      `Unexpected HTTP status for ${method} ${path}`,
    );
    if (
      [
        '/requests',
        '/work-orders',
        '/technicians',
        '/invoices',
        '/payments',
      ].some((prefix) => path.startsWith(prefix))
    )
      assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).data;
  }

  for (const email of emails.slice(0, 2)) {
    await call('/auth/register', 201, {
      method: 'POST',
      body: { email, password, name: 'Compiled Customer' },
    });
  }
  const bootstrap = async (role, email, seedPassword = password) =>
    promisify(execFile)(process.execPath, [`scripts/seed-${role}.mjs`], {
      env: {
        ...process.env,
        [`SEED_${role.toUpperCase()}_EMAIL`]: email,
        [`SEED_${role.toUpperCase()}_PASSWORD`]: seedPassword,
      },
      timeout: 15000,
    });
  await assert.rejects(bootstrap('admin', emails[0]), { code: 1 });
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } })).role,
    'CUSTOMER',
  );
  await bootstrap('admin', emails[2]);
  await Promise.all([
    bootstrap('technician', emails[3]),
    bootstrap('technician', emails[3]),
  ]);
  await bootstrap('technician', emails[3], `changed password ${randomUUID()}`);
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
  const technician = await login(emails[3]);
  const technicianAccount = await prisma.user.findUniqueOrThrow({
    where: { email: emails[3] },
    select: { id: true },
  });
  assert.equal(
    await prisma.auditLog.count({
      where: {
        entityId: technicianAccount.id,
        action: 'TECHNICIAN_BOOTSTRAPPED',
      },
    }),
    1,
  );
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
  await call(`/technicians/${technicianAccount.id}/skills`, 200, {
    method: 'PUT',
    token: admin,
    body: { serviceIds: [serviceId] },
  });
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 90000000).toISOString();
  const query = new URLSearchParams({ serviceId, start, end });
  assert(
    (await call(`/technicians?${query}`, 200, { token: admin })).items.some(
      (item) => item.id === technicianAccount.id,
    ),
  );
  const newRequest = async () =>
    call('/requests', 201, {
      method: 'POST',
      token: customer,
      body: {
        serviceId,
        description: 'Inspect the heating control.',
        address: 'House 12, Road 3, Dhaka',
        preferredStart: start,
      },
    });
  const dispatch = async () => {
    const req = await newRequest();
    await call(`/requests/${req.id}/review`, 200, {
      method: 'PATCH',
      token: admin,
      body: { version: 1, decision: 'APPROVE' },
    });
    return call(`/requests/${req.id}/assignment`, 201, {
      method: 'POST',
      token: admin,
      body: { technicianId: technicianAccount.id, start, end },
    });
  };
  const cancellable = await dispatch();
  const cancelledWork = await call(
    `/requests/${cancellable.requestId}/cancel`,
    200,
    {
      method: 'POST',
      token: customer,
      body: {
        version: cancellable.request.version,
        reason: 'Visit no longer needed',
      },
    },
  );
  assert.equal(cancelledWork.workOrder.status, 'CANCELLED');
  const work = await dispatch();
  assert.equal(work.agreedPriceMinor, 150000);
  await call(`/work-orders/${work.id}`, 404, { token: other });
  assert.equal(
    (
      await call(`/work-orders?serviceId=${serviceId}&status=ASSIGNED`, 200, {
        token: technician,
      })
    ).pagination.total,
    1,
  );
  await call(`/work-orders/${work.id}/schedule`, 200, {
    method: 'PATCH',
    token: admin,
    body: { version: 1, technicianId: technicianAccount.id, start, end },
  });
  await call(`/work-orders/${work.id}/status`, 409, {
    method: 'PATCH',
    token: technician,
    body: { version: 1, status: 'EN_ROUTE' },
  });
  await call(`/work-orders/${work.id}/status`, 200, {
    method: 'PATCH',
    token: technician,
    body: { version: 2, status: 'EN_ROUTE' },
  });
  await call(`/requests/${work.requestId}/cancel`, 409, {
    method: 'POST',
    token: customer,
    body: { version: work.request.version, reason: 'Visit already started' },
  });
  await call(`/work-orders/${work.id}/status`, 200, {
    method: 'PATCH',
    token: technician,
    body: { version: 3, status: 'IN_PROGRESS' },
  });
  const detail = await call(`/work-orders/${work.id}`, 200, {
    token: customer,
  });
  assert.equal(detail.status, 'IN_PROGRESS');
  assert.equal(detail.timeline.length, 4);
  const completionBody = {
    version: 4,
    report: 'Inspection and repair completed.',
  };
  const completed = await call(`/work-orders/${work.id}/complete`, 200, {
    method: 'POST',
    token: technician,
    body: completionBody,
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.version, 5);
  assert.equal(completed.invoice.amountMinor, work.agreedPriceMinor);
  assert.equal(completed.invoice.status, 'UNPAID');
  const repeat = await call(`/work-orders/${work.id}/complete`, 200, {
    method: 'POST',
    token: technician,
    body: completionBody,
  });
  assert.deepEqual(repeat, completed);
  const invoice = await call(`/invoices/${completed.invoice.id}`, 200, {
    token: customer,
  });
  assert.deepEqual(invoice, completed.invoice);
  await call(`/work-orders/${work.id}/feedback`, 409, {
    method: 'POST',
    token: customer,
    body: { rating: 5 },
  });
  await call(`/invoices/${invoice.id}`, 404, { token: other });
  await call(`/invoices/${invoice.id}`, 403, { token: technician });
  await call(`/invoices/${invoice.id}`, 200, { token: admin });
  assert.equal(
    await prisma.invoice.count({ where: { workOrderId: work.id } }),
    1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: work.id, action: 'WORK_ORDER_COMPLETED' },
    }),
    1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: invoice.id, action: 'INVOICE_ISSUED' },
    }),
    1,
  );
  const finalWork = await call(`/work-orders/${work.id}`, 200, {
    token: technician,
  });
  assert.deepEqual(finalWork.invoice, invoice);
  assert.equal(finalWork.timeline.length, 5);
  await call('/users/me', 200, {
    method: 'PATCH',
    token: customer,
    body: { phone: '+8801712345678' },
  });
  const gatewayCharges = new Map();
  let initiations = 0;
  app.get(GatewayHttpService).json = async (url, form) => {
    if (form) {
      initiations++;
      assert.equal(form.get('total_amount'), '1500.00');
      const merchantTranId = form.get('tran_id');
      const persisted = await prisma.payment.findUniqueOrThrow({
        where: { merchantTranId },
      });
      assert.equal(persisted.status, 'INITIATING');
      gatewayCharges.set(merchantTranId, {
        APIConnect: 'DONE',
        status: 'VALID',
        tran_id: merchantTranId,
        val_id: `val-${tag}`,
        bank_tran_id: `bank-${tag}`,
        amount: '1500.00',
        currency: 'BDT',
        currency_type: 'BDT',
        currency_amount: '1500.00',
        risk_level: '0',
      });
      return {
        status: 'SUCCESS',
        sessionkey: `session-${tag}`,
        GatewayPageURL: `https://sandbox.sslcommerz.com/pay?s=${tag}`,
      };
    }
    assert.equal(url.origin, 'https://sandbox.sslcommerz.com');
    if (url.searchParams.has('val_id'))
      return [...gatewayCharges.values()].find(
        (charge) => charge.val_id === url.searchParams.get('val_id'),
      );
    const charge = gatewayCharges.get(url.searchParams.get('tran_id'));
    return {
      APIConnect: 'DONE',
      no_of_trans_found: charge ? 1 : 0,
      element: charge ? [charge] : [],
    };
  };
  const sessionPath = `/invoices/${invoice.id}/payment-session`;
  const paymentBody = {
    billing: { address: 'House 12, Road 3', city: 'Dhaka', postcode: '1000' },
  };
  const headers = { 'Idempotency-Key': randomUUID() };
  const checkout = await call(sessionPath, 201, {
    method: 'POST',
    token: customer,
    body: paymentBody,
    headers,
  });
  assert.equal(checkout.status, 'PENDING');
  assert.deepEqual(
    await call(sessionPath, 200, {
      method: 'POST',
      token: customer,
      body: paymentBody,
      headers,
    }),
    checkout,
  );
  assert.equal(initiations, 1);
  await call(`/payments/${checkout.id}`, 404, { token: other });
  await call(`/payments/${checkout.id}`, 403, { token: technician });
  const attempt = await prisma.payment.findUniqueOrThrow({
    where: { id: checkout.id },
  });
  const charge = gatewayCharges.get(attempt.merchantTranId);
  for (const kind of ['ipn', 'success']) {
    const notification = await fetch(`${base}/payments/sslcommerz/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        tran_id: attempt.merchantTranId,
        val_id: charge.val_id,
        amount: '1.00',
        status: 'FAILED',
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(notification.status, 200);
    assert.equal(notification.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await notification.json()).data, { received: true });
  }
  const paid = await call(`/invoices/${invoice.id}`, 200, { token: customer });
  assert.equal(paid.status, 'PAID');
  assert.equal(
    (await call(`/payments/${checkout.id}`, 200, { token: admin })).status,
    'SUCCEEDED',
  );
  assert.equal(
    (await call(`/work-orders/${work.id}`, 200, { token: technician })).invoice
      .status,
    'PAID',
  );
  await call(sessionPath, 409, {
    method: 'POST',
    token: customer,
    body: paymentBody,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(
    await prisma.paymentReceipt.count({ where: { paymentId: attempt.id } }),
    1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: invoice.id, action: 'INVOICE_PAID' },
    }),
    1,
  );
  const feedbackPath = `/work-orders/${work.id}/feedback`;
  const feedbackBody = { rating: 5, comment: '  Excellent service.  ' };
  await call(feedbackPath, 404, {
    method: 'POST',
    token: other,
    body: feedbackBody,
  });
  await call(feedbackPath, 403, {
    method: 'POST',
    token: technician,
    body: feedbackBody,
  });
  const feedback = await call(feedbackPath, 201, {
    method: 'POST',
    token: customer,
    body: feedbackBody,
  });
  assert.equal(feedback.comment, 'Excellent service.');
  assert.equal(feedback.rating, 5);
  assert.equal(feedback.workOrderId, work.id);
  await call(feedbackPath, 409, {
    method: 'POST',
    token: customer,
    body: feedbackBody,
  });
  for (const token of [customer, technician, admin]) {
    const detail = await call(`/work-orders/${work.id}`, 200, { token });
    assert.deepEqual(detail.feedback, feedback);
    assert.equal(
      detail.timeline.filter((event) => event.action === 'FEEDBACK_SUBMITTED')
        .length,
      1,
    );
  }
  assert.deepEqual(
    (await call(`/requests/${work.requestId}`, 200, { token: customer }))
      .workOrder.feedback,
    feedback,
  );
  assert.equal(
    await prisma.feedback.count({ where: { workOrderId: work.id } }),
    1,
  );
  const managed = (
    await call(`/admin/users?q=${encodeURIComponent(emails[1])}`, 200, {
      token: admin,
    })
  ).items[0];
  assert.equal(managed.email, emails[1]);
  assert.equal(Object.hasOwn(managed, 'passwordHash'), false);
  await call('/admin/users', 403, { token: customer });
  const overview = await call('/admin/overview', 200, { token: admin });
  assert.equal(overview.invoices.verifiedRevenueMinor, '150000');
  assert.equal(overview.invoices.paidCount, 1);
  const managedPath = `/admin/users/${managed.id}`;
  await call(managedPath, 200, {
    method: 'PATCH',
    token: admin,
    body: { status: 'SUSPENDED' },
  });
  await call('/users/me', 401, { token: other });
  await call(managedPath, 200, {
    method: 'PATCH',
    token: admin,
    body: { status: 'ACTIVE' },
  });
  await call('/users/me', 401, { token: other });
  await call('/users/me', 200, { token: await login(emails[1]) });
  const audit = await call(
    `/admin/audit-logs?entityId=${managed.id}&action=USER_ACCESS_UPDATED`,
    200,
    { token: admin },
  );
  assert.equal(audit.pagination.total, 2);
  assert.deepEqual(
    Object.keys(audit.items[0].metadata).sort(),
    ['previousRole', 'role', 'previousStatus', 'status'].sort(),
  );
  console.log(
    'Compiled HTTP workflow passed: safe bootstrap, authentication, request lifecycle, scheduling, scoped work, atomic cancellation, completion, invoices, verified idempotent payment settlement (test transport), audited customer feedback and administration/access revocation',
  );
} finally {
  await prisma
    .$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      const paymentIds = (
        await tx.payment.findMany({
          where: { userId: { in: ids } },
          select: { id: true },
        })
      ).map((row) => row.id);
      const invoiceIds = (
        await tx.invoice.findMany({
          where: { customerId: { in: ids } },
          select: { id: true },
        })
      ).map((row) => row.id);
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: 'PAYMENT', entityId: { in: paymentIds } },
            { entityType: 'INVOICE', entityId: { in: invoiceIds } },
          ],
        },
      });
      await tx.paymentReceipt.deleteMany({
        where: { paymentId: { in: paymentIds } },
      });
      await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await tx.feedback.deleteMany({ where: { customerId: { in: ids } } });
      await tx.invoice.deleteMany({ where: { customerId: { in: ids } } });
      await tx.workOrder.deleteMany({
        where: { request: { customerId: { in: ids } } },
      });
      await tx.technicianSkill.deleteMany({ where: { userId: { in: ids } } });
      await tx.serviceRequest.deleteMany({
        where: { customerId: { in: ids } },
      });
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: ids } },
            { entityType: 'USER', entityId: { in: ids } },
          ],
        },
      });
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
