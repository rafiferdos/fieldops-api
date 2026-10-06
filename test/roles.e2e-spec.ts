import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { Roles } from '../src/modules/auth/decorators/roles.decorator.js';
import { Public } from '../src/modules/auth/decorators/public.decorator.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

// Test routes are registered only in this test application, never in AppModule.
@Controller('role-check')
@Roles(Role.ADMIN)
class RoleCheckController {
  @Get('admin')
  admin() {
    return { allowed: true };
  }

  @Get('technician')
  @Roles(Role.TECHNICIAN)
  technician() {
    return { allowed: true };
  }

  @Get('staff')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  staff() {
    return { allowed: true };
  }

  @Get('contradictory-public')
  @Public()
  contradictoryPublic() {
    return { allowed: true };
  }
}

describe('Role authorization (e2e)', () => {
  let api: TestApi;
  let email: string;
  let accessToken: string;
  const password = 'role guard integration passphrase';

  beforeEach(async () => {
    email = `roles-${randomUUID()}@example.com`;
    api = await createTestApi([RoleCheckController]);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Role Customer', email, password })
      .expect(201);
    accessToken = (
      await request(api.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.data.accessToken;
  });
  afterEach(async () => closeTestApi(api, email));

  const get = (path: string, token = accessToken) =>
    request(api.app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);

  it.each([
    { role: Role.CUSTOMER, admin: 403, technician: 403, staff: 403 },
    { role: Role.TECHNICIAN, admin: 403, technician: 200, staff: 200 },
    { role: Role.ADMIN, admin: 200, technician: 403, staff: 200 },
  ])(
    'applies class roles, method overrides and explicit role lists for $role',
    async (expected) => {
      await api.prisma.user.update({
        where: { email },
        data: { role: expected.role },
      });
      await get('role-check/admin').expect(expected.admin);
      await get('role-check/technician').expect(expected.technician);
      await get('role-check/staff').expect(expected.staff);
      await get('users/me').expect(200);
    },
  );

  it('does not trust client-supplied or stale roles', async () => {
    await get('role-check/admin?role=ADMIN').expect(403);
    await api.prisma.user.update({
      where: { email },
      data: { role: Role.ADMIN },
    });
    await get('role-check/admin').expect(200);
    await api.prisma.user.update({
      where: { email },
      data: { role: Role.CUSTOMER },
    });
    const denied = await get('role-check/admin').expect(403);
    expect(denied.body).toEqual({
      success: false,
      message: 'You do not have permission to access this resource',
      errors: [],
    });
  });

  it('returns 401 for absent/invalid/revoked authentication before role checks', async () => {
    await request(api.app.getHttpServer())
      .get('/api/v1/role-check/admin')
      .expect(401);
    await get('role-check/admin', 'invalid').expect(401);
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await get('role-check/admin').expect(401);
  });

  it('fails closed for contradictory public and role-restricted metadata', async () => {
    await request(api.app.getHttpServer())
      .get('/api/v1/role-check/contradictory-public')
      .expect(401);
    await get('role-check/contradictory-public').expect(401);
    await request(api.app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
