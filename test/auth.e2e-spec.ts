import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { verify } from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Customer registration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let api: TestApi | undefined;
  let email: string;
  const password = '  a long test passphrase  ';
  const endpoint = '/api/v1/auth/register';

  beforeEach(async () => {
    email = `registration-${randomUUID()}@example.com`;
    api = undefined;
    api = await createTestApi();
    ({ app, prisma } = api);
  });

  afterEach(async () => {
    await closeTestApi(api, email);
  });

  it('creates a normalized CUSTOMER with a salted hash and safe response fields', async () => {
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send({
        name: '  Rafi Ferdos  ',
        email: ` ${email.toUpperCase()} `,
        password,
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'Account created successfully',
      data: {
        id: expect.any(String),
        name: 'Rafi Ferdos',
        email,
        role: 'CUSTOMER',
        createdAt: expect.any(String),
      },
    });
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(stored.passwordHash!.split('$')[3].split(',')).toEqual(
      expect.arrayContaining(['m=19456', 't=2', 'p=1']),
    );
    expect(await verify(stored.passwordHash!, password)).toBe(true);
    expect(await verify(stored.passwordHash!, password.trim())).toBe(false);
    expect(stored.role).toBe('CUSTOMER');
    expect(stored.status).toBe('ACTIVE');
    expect(stored.deletedAt).toBeNull();
  });

  it.each([
    { name: ' ' },
    { email: 'invalid-email' },
    { password: 'short' },
    { password: 'x'.repeat(129) },
    { role: 'ADMIN' },
    { status: 'SUSPENDED' },
  ])('rejects invalid or privileged input: %j', async (overrides) => {
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send({ name: 'Rafi', email, password, ...overrides })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Request validation failed',
      errors: expect.any(Array),
    });
    expect(response.body.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('returns 409 for a normalized duplicate email, including soft-deleted accounts', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .send({ name: 'Rafi', email, password })
      .expect(201);
    await prisma.user.update({
      where: { email },
      data: { deletedAt: new Date() },
    });
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send({ name: 'Another customer', email: email.toUpperCase(), password })
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      message: 'Email is already registered',
      errors: [],
    });
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('allows exactly one account when requests race for the same email', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(endpoint)
        .send({ name: 'First customer', email, password }),
      request(app.getHttpServer()).post(endpoint).send({
        name: 'Second customer',
        email: email.toUpperCase(),
        password,
      }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('rate limits registration attempts before password hashing', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await request(app.getHttpServer())
        .post(endpoint)
        .send({ name: 'Rafi', email, password: 'short' })
        .expect(400);
    }
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .send({ name: 'Rafi', email, password })
      .expect(429);
    expect(response.body).toMatchObject({ success: false, errors: [] });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
