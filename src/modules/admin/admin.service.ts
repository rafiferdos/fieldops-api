import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { pagination } from '../../common/http/pagination.js';
import type { AuthActor } from '../auth/auth.types.js';
import type { AdminUsersQuery, AuditQuery } from './admin.schema.js';
import { auditMetadata } from './audit-metadata.js';

export const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  users(actor: AuthActor, query: AdminUsersQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        await requireActiveActor(tx, actor, ['ADMIN']);
        const where: Prisma.UserWhereInput = {
          deletedAt: null,
          role: query.role,
          status: query.status,
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { email: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        const items = await tx.user.findMany({
          where,
          select: adminUserSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [
            { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
            { id: 'asc' },
          ],
        });
        return {
          items,
          pagination: pagination(await tx.user.count({ where }), query),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  auditLogs(actor: AuthActor, query: AuditQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        await requireActiveActor(tx, actor, ['ADMIN']);
        const where: Prisma.AuditLogWhereInput = {
          entityType: query.entityType,
          entityId: query.entityId,
          actorId: query.actorId,
          action: query.action,
          ...(query.from
            ? { createdAt: { gte: query.from, lt: query.to } }
            : {}),
        };
        const rows = await tx.auditLog.findMany({
          where,
          select: {
            id: true,
            actorId: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            createdAt: true,
          },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        });
        return {
          items: rows.map((row) => ({
            ...row,
            metadata: auditMetadata(row.action, row.metadata),
          })),
          pagination: pagination(await tx.auditLog.count({ where }), query),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
