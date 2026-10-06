import { Inject, Injectable } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/enums.js';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../common/security/refresh-token.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { publicUserSelect } from '../users/users.select.js';
import type { SessionCredentials } from './auth.types.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SessionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    expectedPasswordHash: string,
  ): Promise<SessionCredentials | null> {
    const refreshToken = createRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          passwordHash: expectedPasswordHash,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: publicUserSelect,
      });
      if (!user) return null;

      const session = await tx.session.create({
        data: {
          userId,
          expiresAt,
          refreshTokens: { create: { tokenHash, expiresAt } },
        },
        select: { id: true, expiresAt: true },
      });
      return { ...session, user, refreshToken };
    });
  }
}
