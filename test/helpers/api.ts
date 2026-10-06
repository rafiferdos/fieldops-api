import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/config/app.config.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

export type TestApi = { app: INestApplication<App>; prisma: PrismaService };

export async function createTestApi(): Promise<TestApi> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  configureApp(app);
  try {
    await app.init();
    return { app, prisma: app.get(PrismaService) };
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function closeTestApi(
  api: TestApi | undefined,
  email?: string,
): Promise<void> {
  if (!api) return;
  try {
    if (email) {
      await api.prisma.$transaction([
        api.prisma.refreshToken.deleteMany({
          where: { session: { user: { email } } },
        }),
        api.prisma.session.deleteMany({ where: { user: { email } } }),
        api.prisma.user.deleteMany({ where: { email } }),
      ]);
    }
  } finally {
    await api.app.close();
  }
}
