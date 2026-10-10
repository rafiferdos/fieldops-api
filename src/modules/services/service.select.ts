import type { Prisma } from '../../generated/prisma/client.js';

export const serviceSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  basePriceMinor: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceSelect;

type SelectedService = Prisma.ServiceGetPayload<{
  select: typeof serviceSelect;
}>;

export function serviceView(service: SelectedService) {
  return {
    ...service,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}
