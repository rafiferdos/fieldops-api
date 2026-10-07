import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestStatus } from '../../generated/prisma/enums.js';

// All request/work-order transitions lock this row first. Caller supplies customer scope.
export async function lockRequest(
  tx: Prisma.TransactionClient,
  id: string,
  customerId?: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      customerId: string;
      serviceId: string;
      status: RequestStatus;
      version: number;
    }>
  >`
    SELECT id, "customerId", "serviceId", status, version FROM "ServiceRequest"
    WHERE id = ${id}::uuid AND "deletedAt" IS NULL
      AND (${customerId === undefined} OR "customerId" = ${customerId ?? null}::uuid)
    FOR UPDATE`;
  if (!rows[0]) throw new NotFoundException('Request not found');
  return rows[0];
}
