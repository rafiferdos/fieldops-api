import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { hashRefreshToken } from '../src/common/security/refresh-token.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

describe('Login and sessions (e2e)', () => {
  let api: TestApi;
  let email: string;
  const password = '  a long session test passphrase  ';

  beforeEach(async () => {
    email = `session-${randomUUID()}@example.com`;
    api = await createTestApi();
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Session Customer', email, password })
      .expect(201);
  });

  afterEach(async () => closeTestApi(api, email));

  const login = () =>
    request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });

  it('issues a short-lived access JWT and stores only the opaque refresh token hash', async () => {
    const response = await request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const data = response.body.data;
    expect(data.user).toEqual({
      id: expect.any(String),
      name: 'Session Customer',
      email,
      role: 'CUSTOMER',
      createdAt: expect.any(String),
    });
    expect(data.tokenType).toBe('Bearer');
    expect(data.expiresIn).toBe(900);
    expect(data.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const claims = await api.app.get(JwtService).verifyAsync(data.accessToken);
    expect(claims.sub).toBe(data.user.id);
    expect(claims.tokenUse).toBe('access');
    expect(claims.exp - claims.iat).toBe(900);
    const token = await api.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(data.refreshToken) },
      include: { session: true },
    });
    expect(token.session.id).toBe(claims.sid);
    expect(token.tokenHash).not.toBe(data.refreshToken);
    expect(token.consumedAt).toBeNull();
    expect(token.session.revokedAt).toBeNull();
    expect(token.session.expiresAt.toISOString()).toBe(data.refreshExpiresAt);
    expect(token.expiresAt).toEqual(token.session.expiresAt);
    expect(token.session.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      6 * 24 * 60 * 60 * 1000,
    );
  });

  it.each([
    'wrong-password',
    'unknown-email',
    'suspended',
    'deleted',
    'google-only',
  ])(
    'returns the same 401 for %s without creating a session',
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
      if (scenario === 'google-only')
        await api.prisma.user.update({
          where: { email },
          data: { passwordHash: null },
        });
      const response = await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: scenario === 'unknown-email' ? `unknown-${email}` : email,
          password:
            scenario === 'wrong-password'
              ? 'wrong long test passphrase'
              : password,
        })
        .expect(401)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toEqual({
        success: false,
        message: 'Invalid email or password',
        errors: [],
      });
      expect(
        await api.prisma.session.count({ where: { user: { email } } }),
      ).toBe(0);
    },
  );

  it('rejects client-supplied role and does not create a session', async () => {
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password, role: 'ADMIN' })
      .expect(400);
    expect(await api.prisma.session.count({ where: { user: { email } } })).toBe(
      0,
    );
  });

  it('limits repeated password guesses', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong long test passphrase' })
        .expect(401);
    }
    await login().expect(429);
    expect(await api.prisma.session.count({ where: { user: { email } } })).toBe(
      0,
    );
  });
});
