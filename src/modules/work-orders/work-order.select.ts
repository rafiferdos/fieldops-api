import type { Prisma } from '../../generated/prisma/client.js';

export const workOrderSummarySelect = {
  id: true,
  technicianId: true,
  status: true,
  version: true,
  scheduledStart: true,
  scheduledEnd: true,
  agreedPriceMinor: true,
  currency: true,
} satisfies Prisma.WorkOrderSelect;
export const workOrderSelect = {
  ...workOrderSummarySelect,
  requestId: true,
  completedAt: true,
  report: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  technician: { select: { id: true, name: true } },
  request: {
    select: {
      id: true,
      customerId: true,
      serviceId: true,
      status: true,
      version: true,
      description: true,
      address: true,
      service: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.WorkOrderSelect;
export function workOrderSummaryView(
  order: Prisma.WorkOrderGetPayload<{ select: typeof workOrderSummarySelect }>,
) {
  return {
    ...order,
    scheduledStart: order.scheduledStart.toISOString(),
    scheduledEnd: order.scheduledEnd.toISOString(),
  };
}
export function workOrderView(
  order: Prisma.WorkOrderGetPayload<{ select: typeof workOrderSelect }>,
) {
  return {
    ...order,
    scheduledStart: order.scheduledStart.toISOString(),
    scheduledEnd: order.scheduledEnd.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
  };
}
