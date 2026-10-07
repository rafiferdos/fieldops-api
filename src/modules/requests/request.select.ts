import type { Prisma } from '../../generated/prisma/client.js';

export const requestSelect = {
  id: true,
  customerId: true,
  serviceId: true,
  description: true,
  address: true,
  preferredStart: true,
  status: true,
  version: true,
  reviewReason: true,
  reviewedAt: true,
  cancellationReason: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true } },
} satisfies Prisma.ServiceRequestSelect;

type SelectedRequest = Prisma.ServiceRequestGetPayload<{
  select: typeof requestSelect;
}>;
export function requestView(request: SelectedRequest) {
  return {
    ...request,
    preferredStart: request.preferredStart.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
  };
}
