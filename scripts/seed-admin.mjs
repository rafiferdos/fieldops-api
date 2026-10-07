import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';
import { AuditService } from '../dist/common/audit/audit.service.js';
import { hashPassword } from '../dist/common/security/password.js';
import {
  emailSchema,
  passwordSchema,
} from '../dist/modules/auth/schemas/credentials.schema.js';
import { nameSchema } from '../dist/modules/users/schemas/profile.schema.js';

const input = z
  .object({
    email: emailSchema,
    password: passwordSchema.min(15),
    name: nameSchema.default('FieldOps Admin'),
  })
  .safeParse({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: process.env.SEED_ADMIN_NAME,
  });
if (!input.success) {
  console.error(
    'Set SEED_ADMIN_EMAIL and a 15–128 character SEED_ADMIN_PASSWORD in .env',
  );
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const { email, password, name } = input.data;
  const passwordHash = await hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    // Serialize bootstrap attempts without ever elevating an existing customer.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`admin-bootstrap:${email}`}, 0))`;
    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true, role: true, status: true, deletedAt: true },
    });
    if (existing) {
      if (
        existing.role !== 'ADMIN' ||
        existing.status !== 'ACTIVE' ||
        existing.deletedAt
      )
        throw new Error('BOOTSTRAP_REFUSED');
      return 'Active admin already exists; credentials unchanged';
    }
    const user = await tx.user.create({
      data: { email, passwordHash, name, role: 'ADMIN' },
      select: { id: true },
    });
    await audit.record(tx, {
      actorId: null,
      action: 'ADMIN_BOOTSTRAPPED',
      entityType: 'USER',
      entityId: user.id,
      metadata: {},
    });
    return 'Admin created; sign in using the credentials in your local .env';
  });
  console.log(result);
} catch (error) {
  console.error(
    error.message === 'BOOTSTRAP_REFUSED'
      ? 'Refusing to modify an existing non-admin, suspended or deleted account'
      : 'Admin bootstrap failed; inspect database availability and migration status',
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
