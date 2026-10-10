import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/config/app.config.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

export type TestApi = { app: INestApplication<App>; prisma: PrismaService };

export async function createTestApi(
  controllers: Type<unknown>[] = [],
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<TestApi> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers,
  });
  configure?.(builder);
  const module = await builder.compile();
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
        api.prisma.auditLog.deleteMany({ where: { actor: { email } } }),
        api.prisma.refreshToken.deleteMany({
          where: { session: { user: { email } } },
        }),
        api.prisma.session.deleteMany({ where: { user: { email } } }),
        api.prisma.authIdentity.deleteMany({ where: { user: { email } } }),
        api.prisma.mediaUpload.deleteMany({ where: { owner: { email } } }),
        api.prisma.user.deleteMany({ where: { email } }),
      ]);
    }
  } finally {
    await api.app.close();
  }
}
