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

export async function bootstrapAccount(role, prefix) {
  z.enum(['ADMIN', 'TECHNICIAN']).parse(role);
  const input = z
    .object({
      email: emailSchema,
      password: passwordSchema.min(15),
      name: nameSchema.default(
        `FieldOps ${role === 'ADMIN' ? 'Admin' : 'Technician'}`,
      ),
    })
    .safeParse({
      email: process.env[`${prefix}_EMAIL`],
      password: process.env[`${prefix}_PASSWORD`],
      name: process.env[`${prefix}_NAME`],
    });
  if (!input.success) {
    console.error(
      `Set ${prefix}_EMAIL and a 15–128 character ${prefix}_PASSWORD in .env`,
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
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`account-bootstrap:${email}`}, 0))`;
      const existing = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, status: true, deletedAt: true },
      });
      if (existing) {
        if (
          existing.role !== role ||
          existing.status !== 'ACTIVE' ||
          existing.deletedAt
        )
          throw new Error('BOOTSTRAP_REFUSED');
        return `Active ${role.toLowerCase()} already exists; credentials unchanged`;
      }
      const user = await tx.user.create({
        data: { email, passwordHash, name, role },
        select: { id: true },
      });
      await audit.record(tx, {
        actorId: null,
        action:
          role === 'ADMIN' ? 'ADMIN_BOOTSTRAPPED' : 'TECHNICIAN_BOOTSTRAPPED',
        entityType: 'USER',
        entityId: user.id,
        metadata: {},
      });
      return `Created ${role.toLowerCase()}; sign in using the credentials in your local .env`;
    });
    console.log(result);
  } catch (error) {
    console.error(
      error.message === 'BOOTSTRAP_REFUSED'
        ? 'Refusing to modify an existing account with another role, suspended or deleted account'
        : 'Account bootstrap failed; inspect database availability and migration status',
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
