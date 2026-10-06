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

  async rotate(rawToken: string): Promise<SessionCredentials | null> {
    const tokenHash = hashRefreshToken(rawToken);
    const refreshToken = createRefreshToken();
    const replacementHash = hashRefreshToken(refreshToken);

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.refreshToken.findUnique({
          where: { tokenHash },
          select: { sessionId: true },
        });
        if (!existing) return null;

        // One lock serializes every refresh and logout for this session family.
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${existing.sessionId}::uuid FOR UPDATE`;
        const current = await tx.refreshToken.findUnique({
          where: { tokenHash },
          select: {
            consumedAt: true,
            expiresAt: true,
            session: {
              select: {
                id: true,
                expiresAt: true,
                revokedAt: true,
                user: {
                  select: {
                    ...publicUserSelect,
                    status: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        });
        if (!current) return null;

        const { session } = current;
        const now = new Date();
        if (
          session.revokedAt ||
          session.expiresAt <= now ||
          current.expiresAt <= now
        )
          return null;

        if (
          current.consumedAt ||
          session.user.status !== UserStatus.ACTIVE ||
          session.user.deletedAt
        ) {
          await tx.session.update({
            where: { id: session.id },
            data: { revokedAt: now },
          });
          // Return normally so the revocation commits before the caller throws 401.
          return null;
        }

        await tx.refreshToken.update({
          where: { tokenHash },
          data: { consumedAt: now },
        });
        await tx.refreshToken.create({
          data: {
            tokenHash: replacementHash,
            sessionId: session.id,
            expiresAt: session.expiresAt,
          },
        });
        const {
          status: _status,
          deletedAt: _deletedAt,
          ...user
        } = session.user;
        return {
          id: session.id,
          expiresAt: session.expiresAt,
          user,
          refreshToken,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async findActive(sessionId: string, userId: string) {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: UserStatus.ACTIVE, deletedAt: null },
      },
      select: { user: { select: publicUserSelect } },
    });
    return session ? { sessionId, user: session.user } : null;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
