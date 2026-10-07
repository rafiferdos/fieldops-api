import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { AuthActor } from '../../modules/auth/auth.types.js';

// Call inside the operation's transaction; the JWT/previous actor role is not authority.
export async function requireActiveActor(
  tx: Prisma.TransactionClient,
  actor: AuthActor,
  roles: readonly [Role, ...Role[]],
) {
  const user = await tx.user.findFirst({
    where: {
      id: actor.user.id,
      status: 'ACTIVE',
      deletedAt: null,
      sessions: {
        some: {
          id: actor.sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      },
    },
    select: { id: true, role: true },
  });
  if (!user)
    throw new UnauthorizedException('Account or session is unavailable');
  if (!roles.includes(user.role))
    throw new ForbiddenException(
      'You do not have permission to perform this action',
    );
  return user;
}
