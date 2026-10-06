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

  const refresh = (refreshToken: string) =>
    request(api.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
  const logout = (accessToken: string) =>
    request(api.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

  it('rotates tokens without extending expiry and commits family revocation on old-token reuse', async () => {
    const original = (await login().expect(200)).body.data;
    const next = (
      await refresh(original.refreshToken)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body.data;
    const latest = (await refresh(next.refreshToken).expect(200)).body.data;
    expect(
      new Set([original.refreshToken, next.refreshToken, latest.refreshToken])
        .size,
    ).toBe(3);
    expect(latest.refreshExpiresAt).toBe(original.refreshExpiresAt);
    expect(next.accessToken).not.toBe(original.accessToken);
    expect(latest.accessToken).not.toBe(next.accessToken);
    const token = await api.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(original.refreshToken) },
    });
    expect(token.consumedAt).not.toBeNull();
    expect(
      await api.prisma.refreshToken.count({
        where: { sessionId: token.sessionId },
      }),
    ).toBe(3);
    await refresh(original.refreshToken).expect(401);
    expect(
      (
        await api.prisma.session.findUniqueOrThrow({
          where: { id: token.sessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    await refresh(latest.refreshToken).expect(401);
    await logout(latest.accessToken).expect(401);
  });

  it('allows one concurrent rotation and revokes the family for the reused request', async () => {
    const original = (await login().expect(200)).body.data;
    const responses = await Promise.all([
      refresh(original.refreshToken),
      refresh(original.refreshToken),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    const winner = responses.find((response) => response.status === 200)!;
    const token = await api.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(original.refreshToken) },
      include: { session: true },
    });
    expect(token.session.revokedAt).not.toBeNull();
    expect(
      await api.prisma.refreshToken.count({
        where: { sessionId: token.sessionId },
      }),
    ).toBe(2);
    await refresh(winner.body.data.refreshToken).expect(401);
  });

  it('logs out only the current session and blocks its remaining tokens', async () => {
    const first = (await login().expect(200)).body.data;
    const second = (await login().expect(200)).body.data;
    const response = await logout(first.accessToken)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({
      success: true,
      message: 'Signed out successfully',
      data: null,
    });
    await refresh(first.refreshToken).expect(401);
    await logout(first.accessToken).expect(401);
    await refresh(second.refreshToken).expect(200);
  });

  it('cannot leave a live session after a logout/refresh race', async () => {
    const original = (await login().expect(200)).body.data;
    const [rotation, signOut] = await Promise.all([
      refresh(original.refreshToken),
      logout(original.accessToken),
    ]);
    expect([200, 401]).toContain(rotation.status);
    expect(signOut.status).toBe(200);
    const token = await api.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(original.refreshToken) },
      include: { session: true },
    });
    expect(token.session.revokedAt).not.toBeNull();
    if (rotation.status === 200)
      await refresh(rotation.body.data.refreshToken).expect(401);
  });

  it.each([
    'session-expired',
    'token-expired',
    'revoked',
    'suspended',
    'deleted',
  ])(
    'rejects refresh for %s without creating a replacement',
    async (scenario) => {
      const original = (await login().expect(200)).body.data;
      const tokenHash = hashRefreshToken(original.refreshToken);
      const token = await api.prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash },
      });
      if (scenario === 'session-expired')
        await api.prisma.session.update({
          where: { id: token.sessionId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      if (scenario === 'token-expired')
        await api.prisma.refreshToken.update({
          where: { tokenHash },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      if (scenario === 'revoked')
        await api.prisma.session.update({
          where: { id: token.sessionId },
          data: { revokedAt: new Date() },
        });
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
      const response = await refresh(original.refreshToken).expect(401);
      expect(response.body).toEqual({
        success: false,
        message: 'Invalid or expired refresh token',
        errors: [],
      });
      expect(
        await api.prisma.refreshToken.count({
          where: { sessionId: token.sessionId },
        }),
      ).toBe(1);
    },
  );

  it('validates the refresh body and requires a Bearer token for logout', async () => {
    await refresh('malformed').expect(400);
    await refresh('a'.repeat(43)).expect(401);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(43), userId: randomUUID() })
      .expect(400);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(401);
    await logout('invalid-token').expect(401);
  });

  const me = (accessToken: string) =>
    request(api.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

  it.each(['CUSTOMER', 'TECHNICIAN', 'ADMIN'] as const)(
    'returns a safe own profile for %s',
    async (role) => {
      await api.prisma.user.update({ where: { email }, data: { role } });
      const tokens = (await login().expect(200)).body.data;
      const response = await me(tokens.accessToken)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toEqual({
        success: true,
        message: 'Profile fetched successfully',
        data: tokens.user,
      });
      expect(response.body.data.role).toBe(role);
      await request(api.app.getHttpServer())
        .get(`/api/v1/users/me?userId=${randomUUID()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200)
        .then((result) => expect(result.body.data.id).toBe(tokens.user.id));
    },
  );

  it('reads the current database role rather than stale token claims', async () => {
    const tokens = (await login().expect(200)).body.data;
    await api.prisma.user.update({
      where: { email },
      data: { role: 'TECHNICIAN' },
    });
    expect((await me(tokens.accessToken).expect(200)).body.data.role).toBe(
      'TECHNICIAN',
    );
  });

  it('keeps authentication endpoints public even with an expired/invalid inherited Bearer header', async () => {
    const tokens = (
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Authorization', 'Bearer invalid-token')
        .send({ email, password })
        .expect(200)
    ).body.data;
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Authorization', 'Bearer invalid-token')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    await request(api.app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it.each(['revoked', 'expired', 'suspended', 'deleted'])(
    'blocks profile access immediately when %s',
    async (scenario) => {
      const tokens = (await login().expect(200)).body.data;
      const claims = await api.app
        .get(JwtService)
        .verifyAsync(tokens.accessToken);
      if (scenario === 'revoked') await logout(tokens.accessToken).expect(200);
      if (scenario === 'expired')
        await api.prisma.session.update({
          where: { id: claims.sid },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
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
      await me(tokens.accessToken)
        .expect(401)
        .expect('Cache-Control', 'no-store');
    },
  );

  it('blocks access tokens after refresh-token reuse commits family revocation', async () => {
    const original = (await login().expect(200)).body.data;
    const next = (await refresh(original.refreshToken).expect(200)).body.data;
    await me(next.accessToken).expect(200);
    await refresh(original.refreshToken).expect(401);
    await me(original.accessToken).expect(401);
    await me(next.accessToken).expect(401);
  });

  it.each([
    'expired',
    'wrong-issuer',
    'wrong-audience',
    'wrong-algorithm',
    'wrong-subject',
    'wrong-session',
    'wrong-purpose',
    'missing-expiry',
    'malformed-session',
    'tampered',
  ])('rejects %s JWTs', async (scenario) => {
    const tokens = (await login().expect(200)).body.data;
    const jwt = api.app.get(JwtService);
    const original = await jwt.verifyAsync(tokens.accessToken);
    const payload = {
      sub: original.sub,
      sid: original.sid,
      tokenUse: 'access',
    };
    if (scenario === 'wrong-subject') payload.sub = randomUUID();
    if (scenario === 'wrong-session') payload.sid = randomUUID();
    if (scenario === 'malformed-session') payload.sid = 'invalid-uuid';
    if (scenario === 'wrong-purpose') payload.tokenUse = 'refresh';
    let token: string;
    if (scenario === 'tampered') {
      const parts = tokens.accessToken.split('.');
      parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
      token = parts.join('.');
    } else {
      token = await jwt.signAsync(payload, {
        ...(scenario === 'missing-expiry'
          ? {}
          : { expiresIn: scenario === 'expired' ? -1 : 900 }),
        ...(scenario === 'wrong-issuer' ? { issuer: 'other-api' } : {}),
        ...(scenario === 'wrong-audience' ? { audience: 'other-client' } : {}),
        ...(scenario === 'wrong-algorithm'
          ? { algorithm: 'HS384' as const }
          : {}),
      });
    }
    await me(token).expect(401);
  });

  it('requires the Bearer scheme and rejects opaque refresh tokens as access tokens', async () => {
    const tokens = (await login().expect(200)).body.data;
    await request(api.app.getHttpServer()).get('/api/v1/users/me').expect(401);
    await request(api.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Basic ${tokens.accessToken}`)
      .expect(401);
    await me(tokens.refreshToken).expect(401);
    await me('a'.repeat(4100)).expect(401);
  });
});
