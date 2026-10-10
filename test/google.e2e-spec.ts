import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import { vi } from 'vitest';
import request from 'supertest';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';
import {
  googleCredential,
  mockGoogleCertificates,
  GOOGLE_TEST_CLIENT_ID,
} from './helpers/google.js';

describe('Google login (e2e)', () => {
  let api: TestApi;
  let email: string;
  let subject: string;

  beforeEach(async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', GOOGLE_TEST_CLIENT_ID);
    mockGoogleCertificates();
    email = `google-${randomUUID()}@example.com`;
    subject = randomUUID();
    api = await createTestApi();
  });

  afterEach(async () => {
    try {
      await closeTestApi(api, email);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  const login = (overrides: Record<string, unknown> = {}) =>
    request(api.app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: googleCredential({ sub: subject, email, ...overrides }),
      });

  it('creates a CUSTOMER with a bound identity and supports the shared profile/refresh/logout flow', async () => {
    const tokens = (
      await login().expect(200).expect('Cache-Control', 'no-store')
    ).body.data;
    expect(tokens.user).toEqual({
      id: expect.any(String),
      name: 'Google Customer',
      avatarUrl: null,
      email,
      role: 'CUSTOMER',
      createdAt: expect.any(String),
    });
    const user = await api.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { identities: true },
    });
    expect(user.passwordHash).toBeNull();
    expect(user.identities).toHaveLength(1);
    expect(user.identities[0]).toMatchObject({
      provider: 'GOOGLE',
      providerSubject: subject,
    });
    await request(api.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    const next = (
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200)
    ).body.data;
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${next.accessToken}`)
      .expect(200);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: next.refreshToken })
      .expect(401);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'arbitrary long passphrase' })
      .expect(401);
  });

  it('serializes simultaneous first sign-ins into one account/identity and two sessions', async () => {
    const responses = await Promise.all([login(), login()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0]!.body.data.user.id).toBe(
      responses[1]!.body.data.user.id,
    );
    expect(await api.prisma.user.count({ where: { email } })).toBe(1);
    expect(
      await api.prisma.authIdentity.count({
        where: { providerSubject: subject },
      }),
    ).toBe(1);
    expect(await api.prisma.session.count({ where: { user: { email } } })).toBe(
      2,
    );
  });

  it('uses the bound subject and preserves stored profile/role when Google email changes', async () => {
    const original = (await login().expect(200)).body.data;
    await api.prisma.user.update({
      where: { email },
      data: { role: 'TECHNICIAN' },
    });
    const next = (
      await login({
        email: `changed-${email}`,
        name: 'Changed Google Name',
      }).expect(200)
    ).body.data;
    expect(next.user).toEqual({ ...original.user, role: 'TECHNICIAN' });
    expect(
      await api.prisma.user.count({ where: { email: `changed-${email}` } }),
    ).toBe(0);
  });

  it.each(['password', 'another-google', 'deleted-password'])(
    'does not auto-link an email belonging to %s',
    async (scenario) => {
      await api.prisma.user.create({
        data: {
          email,
          name: 'Existing Customer',
          passwordHash:
            scenario === 'another-google' ? null : 'not-used-by-google',
          deletedAt: scenario === 'deleted-password' ? new Date() : null,
          ...(scenario === 'another-google'
            ? {
                identities: {
                  create: { provider: 'GOOGLE', providerSubject: randomUUID() },
                },
              }
            : {}),
        },
      });
      const response = await login().expect(409);
      expect(response.body.message).toBe(
        'Email is already registered; sign in using your existing method',
      );
      expect(
        await api.prisma.authIdentity.count({
          where: { providerSubject: subject },
        }),
      ).toBe(0);
      expect(
        await api.prisma.session.count({ where: { user: { email } } }),
      ).toBe(0);
    },
  );

  it.each(['suspended', 'deleted'])(
    'denies %s bound accounts without creating a session',
    async (scenario) => {
      await login().expect(200);
      await api.prisma.user.update({
        where: { email },
        data:
          scenario === 'suspended'
            ? { status: 'SUSPENDED' }
            : { deletedAt: new Date() },
      });
      await login().expect(401);
      expect(
        await api.prisma.session.count({ where: { user: { email } } }),
      ).toBe(1);
    },
  );

  it('rejects wrong audiences and unverified emails before creating any account', async () => {
    await login({ aud: 'another-client.apps.googleusercontent.com' }).expect(
      401,
    );
    await login({ email_verified: false }).expect(401);
    expect(await api.prisma.user.count({ where: { email } })).toBe(0);
  });

  it.each([
    {},
    { credential: '' },
    { credential: 123 },
    { credential: 'a'.repeat(8193) },
    { credential: 'invalid', role: 'ADMIN' },
  ])('rejects malformed input: %j', async (body) => {
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/google')
      .send(body)
      .expect(400);
    expect(await api.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('accepts the configured browser origin and rejects foreign origins/form submissions', async () => {
    const credential = googleCredential({ sub: subject, email });
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/google')
      .set('Origin', 'https://attacker.example')
      .send({ credential })
      .expect(403);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/google')
      .type('form')
      .send({ credential })
      .expect(415);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/google')
      .set('Origin', process.env.FRONTEND_ORIGIN!)
      .set('Authorization', 'Bearer invalid-inherited-token')
      .send({ credential })
      .expect(200);
  });

  it('rate limits invalid credential attempts', async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/google')
        .send({ credential: 'invalid' })
        .expect(401);
    await login().expect(429);
    expect(await api.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('rolls back account/identity creation if session persistence fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(
      api.app.get(SessionsService),
      'createInTransaction',
    ).mockRejectedValueOnce(new Error('Simulated persistence failure'));
    await login().expect(500);
    expect(await api.prisma.user.count({ where: { email } })).toBe(0);
    expect(
      await api.prisma.authIdentity.count({
        where: { providerSubject: subject },
      }),
    ).toBe(0);
    await login().expect(200);
  });

  it('returns 503 without configuration while password authentication still works', async () => {
    await closeTestApi(api, email);
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    api = await createTestApi();
    await login().expect(503);
    const password = 'separate password login passphrase';
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Password Customer', email, password })
      .expect(201);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
  });
});
