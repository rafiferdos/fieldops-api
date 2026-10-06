import type { Prisma } from '../../generated/prisma/client.js';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export const ownProfileSelect = {
  ...publicUserSelect,
  phone: true,
} satisfies Prisma.UserSelect;

export type OwnProfile = Prisma.UserGetPayload<{
  select: typeof ownProfileSelect;
}>;
