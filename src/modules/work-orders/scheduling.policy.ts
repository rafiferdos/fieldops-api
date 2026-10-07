import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  WorkOrderStatus,
  Role,
  UserStatus,
  Currency,
} from '../../generated/prisma/enums.js';

export const activeWorkStatuses = [
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
] as const satisfies readonly WorkOrderStatus[];

export function assertVisitWindow(start: Date, end: Date) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start.getTime() <= Date.now() ||
    end <= start ||
    end.getTime() - start.getTime() > 8 * 3600000
  )
    throw new BadRequestException(
      'Visit must start in the future and last at most 8 hours',
    );
}

// Every skill/assignment writer takes these locks, in UUID order, after the request lock.
// Future admin role changes must also lock the technician User row.
export async function lockTechnicians(
  tx: Prisma.TransactionClient,
  ids: readonly [string, ...string[]],
) {
  return tx.$queryRaw<
    Array<{
      id: string;
      role: Role;
      status: UserStatus;
      deletedAt: Date | null;
    }>
  >(
    Prisma.sql`SELECT id, role, status, "deletedAt" FROM "User"
      WHERE id IN (${Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`,
  );
}

export async function lockActiveServices(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  if (!ids.length) return [];
  const services = await tx.$queryRaw<
    Array<{ id: string; basePriceMinor: number; currency: Currency }>
  >(
    Prisma.sql`SELECT id, "basePriceMinor", currency FROM "Service"
      WHERE id IN (${Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`))})
      AND "deletedAt" IS NULL ORDER BY id FOR SHARE`,
  );
  if (services.length !== new Set(ids).size)
    throw new NotFoundException('Service not found');
  return services;
}
