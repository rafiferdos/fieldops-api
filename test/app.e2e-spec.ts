import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/config/app.config.js';

describe('API foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves liveness at the production prefix with security and CORS headers', async () => {
    const origin = app.get(ConfigService).getOrThrow<string>('FRONTEND_ORIGIN');
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', origin)
      .expect(200)
      .expect('Access-Control-Allow-Origin', origin)
      .expect('X-Content-Type-Options', 'nosniff');

    expect(response.body).toEqual({
      success: true,
      message: 'API is running',
      data: { status: 'ok' },
    });
  });

  it('queries the configured database through PrismaService', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(response.body).toEqual({
      success: true,
      message: 'API is ready',
      data: { database: 'up' },
    });
  });

  it('returns the required error shape for an unknown API route', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/missing')
      .expect(404);
    expect(response.body).toEqual({
      success: false,
      message: expect.any(String),
      errors: [],
    });
  });

  it.each(['/', '/health'])(
    'does not expose a route outside the API prefix: %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );
});
