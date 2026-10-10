import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { z } from 'zod';
import { CloudinaryService } from '../src/infrastructure/media/cloudinary.service.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { createTestApi, closeTestApi, type TestApi } from './helpers/api.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
  'base64',
);
const responseSchema = z.object({
  data: z.object({ id: z.uuid(), url: z.url() }),
});
const credentialsSchema = z.object({
  data: z.object({ accessToken: z.string(), user: z.object({ id: z.uuid() }) }),
});

describe('Authenticated image uploads and attachment (e2e)', () => {
  let api: TestApi;
  let email: string;
  let userId: string;
  let accessToken: string;
  const services: string[] = [];
  const cloudUpload = vi.fn<CloudinaryService['upload']>(
    async (_buffer, _mime, publicId) => ({
      publicId,
      url: `https://res.cloudinary.com/fieldops-test/image/upload/v1/${publicId}.webp`,
    }),
  );
  beforeEach(async () => {
    cloudUpload.mockClear();
    email = `media-${randomUUID()}@example.com`;
    api = await createTestApi([], (builder) =>
      builder
        .overrideProvider(CloudinaryService)
        .useValue({ upload: cloudUpload }),
    );
    await request(api.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Image Test Customer',
        email,
        password: 'image test private passphrase',
      })
      .expect(201);
    const login = await request(api.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'image test private passphrase' })
      .expect(200);
    const session = credentialsSchema.parse(login.body).data;
    userId = session.user.id;
    accessToken = session.accessToken;
  });
  afterEach(async () => {
    await api.prisma.auditLog.deleteMany({
      where: { entityId: { in: services } },
    });
    await api.prisma.service.deleteMany({ where: { id: { in: services } } });
    services.length = 0;
    await closeTestApi(api, email);
  });
  const upload = (purpose: string, data = png, type = 'image/png') =>
    request(api.app.getHttpServer())
      .post('/api/v1/media/images')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('purpose', purpose)
      .attach('file', data, { filename: 'photo.png', contentType: type });
  const profile = (body: object) =>
    request(api.app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  it('stores a verified upload and applies/removes an owned avatar with an atomic audit', async () => {
    const uploaded = responseSchema.parse(
      (await upload('AVATAR').expect(201)).body,
    ).data;
    const updated = await profile({ avatarUrl: uploaded.url }).expect(200);
    expect(updated.body.data.avatarUrl).toBe(uploaded.url);
    expect(
      (
        await request(api.app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      ).body.data.avatarUrl,
    ).toBe(uploaded.url);
    const audit = await api.prisma.auditLog.findFirstOrThrow({
      where: { actorId: userId, action: 'USER_PROFILE_UPDATED' },
    });
    expect(audit.metadata).toEqual({ updatedFields: ['avatarUrl'] });
    expect(
      (await profile({ avatarUrl: null }).expect(200)).body.data.avatarUrl,
    ).toBeNull();
  });
  it('rejects unverified URLs and a mismatched upload purpose', async () => {
    await profile({
      avatarUrl: `https://res.cloudinary.com/fieldops-test/image/upload/v1/fieldops/avatar/${userId}/unknown.webp`,
    }).expect(400);
    await api.prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' },
    });
    const uploaded = responseSchema.parse(
      (await upload('SERVICE').expect(201)).body,
    ).data;
    await profile({ avatarUrl: uploaded.url }).expect(400);
    expect(
      (await api.prisma.user.findUniqueOrThrow({ where: { id: userId } }))
        .avatarUrl,
    ).toBeNull();
  });
  it('rechecks account eligibility after provider upload before committing ownership', async () => {
    cloudUpload.mockImplementationOnce(async (_buffer, _mime, publicId) => {
      await api.prisma.user.update({
        where: { id: userId },
        data: { status: 'SUSPENDED' },
      });
      return {
        publicId,
        url: `https://res.cloudinary.com/fieldops-test/image/upload/v1/${publicId}.webp`,
      };
    });
    await upload('AVATAR').expect(401);
    expect(
      await api.prisma.mediaUpload.count({ where: { ownerId: userId } }),
    ).toBe(0);
    expect(
      await api.prisma.auditLog.count({
        where: { actorId: userId, action: 'IMAGE_UPLOADED' },
      }),
    ).toBe(0);
  });
  it('rolls back the ownership record when its audit cannot commit', async () => {
    const record = vi
      .spyOn(api.app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('test audit unavailable'));
    try {
      await upload('AVATAR').expect(500);
      expect(
        await api.prisma.mediaUpload.count({ where: { ownerId: userId } }),
      ).toBe(0);
    } finally {
      record.mockRestore();
    }
  });
  it('rejects another owners uploaded avatar even for an administrator', async () => {
    const uploaded = responseSchema.parse(
      (await upload('AVATAR').expect(201)).body,
    ).data;
    const other = await api.prisma.user.create({
      data: {
        name: 'Other Image Owner',
        email: `other-${randomUUID()}@example.com`,
      },
    });
    try {
      await api.prisma.mediaUpload.update({
        where: { id: uploaded.id },
        data: { ownerId: other.id },
      });
      await api.prisma.user.update({
        where: { id: userId },
        data: { role: 'ADMIN' },
      });
      await profile({ avatarUrl: uploaded.url }).expect(400);
    } finally {
      await api.prisma.mediaUpload.delete({ where: { id: uploaded.id } });
      await api.prisma.user.delete({ where: { id: other.id } });
    }
  });
  it('permits only an administrator to upload and attach a catalog image', async () => {
    await upload('SERVICE').expect(403);
    expect(cloudUpload).not.toHaveBeenCalled();
    await api.prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' },
    });
    const uploaded = responseSchema.parse(
      (await upload('SERVICE').expect(201)).body,
    ).data;
    const created = await request(api.app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Image Test Service',
        description: 'A real validated catalog image attachment test.',
        basePriceMinor: 150000,
        imageUrl: uploaded.url,
      })
      .expect(201);
    const id = z
      .object({ data: z.object({ id: z.uuid() }) })
      .parse(created.body).data.id;
    services.push(id);
    const detail = await request(api.app.getHttpServer())
      .get(`/api/v1/services/${id}`)
      .expect(200);
    expect(detail.body.data.imageUrl).toBe(uploaded.url);
    expect(detail.body.data.basePriceMinor).toBe(150000);
    await request(api.app.getHttpServer())
      .patch(`/api/v1/services/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ imageUrl: null })
      .expect(200);
    expect(
      (
        await request(api.app.getHttpServer())
          .get(`/api/v1/services/${id}`)
          .expect(200)
      ).body.data.imageUrl,
    ).toBeNull();
  });
  it.each([
    [Buffer.from('<svg/>'), 'image/svg+xml', 400],
    [Buffer.from('<script/>'), 'image/png', 400],
    [Buffer.alloc(3 * 1024 * 1024 + 1), 'image/png', 413],
  ] as const)(
    'rejects unsafe files before calling the provider',
    async (bytes, type, status) => {
      await upload('AVATAR', bytes, type).expect(status);
      expect(cloudUpload).not.toHaveBeenCalled();
    },
  );
  it('rejects anonymous uploads before reading the multipart file', async () => {
    await request(api.app.getHttpServer())
      .post('/api/v1/media/images')
      .field('purpose', 'AVATAR')
      .attach('file', png, 'photo.png')
      .expect(401);
    expect(cloudUpload).not.toHaveBeenCalled();
  });
});
