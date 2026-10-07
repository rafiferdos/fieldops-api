import { ServiceUnavailableException } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export function databaseErrorCode(error: unknown): string | undefined {
  // Query failures are wrapped; COMMIT/ROLLBACK failures can escape as adapter errors.
  const adapter =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta?.['driverAdapterError']
      : error instanceof Error && error.name === 'DriverAdapterError'
        ? error
        : undefined;
  if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter))
    return;
  const cause = adapter.cause;
  if (typeof cause !== 'object' || cause === null || !('originalCode' in cause))
    return;
  return typeof cause.originalCode === 'string'
    ? cause.originalCode
    : undefined;
}

// Only DB-only callbacks: a retry must never repeat an external side effect.
export async function serializable<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      const retryable =
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034') ||
        ['40001', '40P01'].includes(databaseErrorCode(error) ?? '');
      if (!retryable) throw error;
      if (attempt === 3)
        throw new ServiceUnavailableException(
          'Concurrent change; retry shortly',
        );
      // Spread competing transactions across bounded retry windows instead of retrying in lockstep.
      await setTimeout(50 * 2 ** attempt + Math.floor(Math.random() * 50));
    }
  }
  throw new ServiceUnavailableException('Concurrent change; retry shortly');
}
