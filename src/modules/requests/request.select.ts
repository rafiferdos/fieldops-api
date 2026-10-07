import type { Prisma } from '../../generated/prisma/client.js';
import {
  workOrderSummarySelect,
  workOrderSummaryView,
} from '../work-orders/work-order.select.js';

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
  workOrder: { select: workOrderSummarySelect },
} satisfies Prisma.ServiceRequestSelect;

type SelectedRequest = Prisma.ServiceRequestGetPayload<{
  select: typeof requestSelect;
}>;
export function requestView(request: SelectedRequest) {
  return {
    ...request,
    workOrder: request.workOrder
      ? workOrderSummaryView(request.workOrder)
      : null,
    preferredStart: request.preferredStart.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
  };
}
