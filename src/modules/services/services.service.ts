import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { Role } from '../../generated/prisma/enums.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { requireOwnedImage } from '../../common/security/owned-image.js';
import { pagination } from '../../common/http/pagination.js';
import { literalSearch } from '../../common/validation/literal-search.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RedisCacheService } from '../../infrastructure/cache/redis-cache.service.js';
import {
  catalogPageSchema,
  publicServiceSchema,
  type CatalogQuery,
} from './schemas/catalog.schema.js';
import type { AuthActor } from '../auth/auth.types.js';
import { serviceSelect, serviceView } from './service.select.js';
import type {
  CreateServiceInput,
  UpdateServiceInput,
} from './schemas/service.schema.js';

@Injectable()
export class ServicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisCacheService) private readonly cache: RedisCacheService,
  ) {}

  async list(query: CatalogQuery) {
    const revision = await this.currentRevision();
    const hash = createHash('sha256')
      .update(JSON.stringify(query))
      .digest('hex');
    return this.cache.remember(
      `catalog:v2:${revision}:list:${hash}`,
      catalogPageSchema,
      async () => {
        // Prisma contains maps to LIKE; escape metacharacters for literal user search.
        const search = literalSearch(query.q);
        const where: Prisma.ServiceWhereInput = {
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        const orders: Record<
          CatalogQuery['sort'],
          Prisma.ServiceOrderByWithRelationInput[]
        > = {
          newest: [{ createdAt: 'desc' }, { id: 'asc' }],
          oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
          name_asc: [{ name: 'asc' }, { id: 'asc' }],
          price_asc: [{ basePriceMinor: 'asc' }, { id: 'asc' }],
          price_desc: [{ basePriceMinor: 'desc' }, { id: 'asc' }],
        };
        const [services, total] = await this.prisma.$transaction(
          [
            this.prisma.service.findMany({
              where,
              select: serviceSelect,
              skip: (query.page - 1) * query.limit,
              take: query.limit,
              orderBy: orders[query.sort],
            }),
            this.prisma.service.count({ where }),
          ],
          { isolationLevel: 'RepeatableRead' },
        );
        return {
          items: services.map(serviceView),
          pagination: pagination(total, query),
        };
      },
    );
  }

  async detail(id: string) {
    const revision = await this.currentRevision();
    return this.cache.remember(
      `catalog:v2:${revision}:detail:${id}`,
      publicServiceSchema,
      async () => {
        const service = await this.prisma.service.findFirst({
          where: { id, deletedAt: null },
          select: serviceSelect,
        });
        if (!service) throw new NotFoundException('Service not found');
        return serviceView(service);
      },
    );
  }

  private async currentRevision() {
    // Every read verifies the committed DB revision, even when Redis has a hit.
    const row = await this.prisma.catalogRevision.findUniqueOrThrow({
      where: { id: 1 },
      select: { revision: true },
    });
    return row.revision.toString();
  }

  async create(actor: AuthActor, input: CreateServiceInput) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveActor(tx, actor, [Role.ADMIN]);
      await requireOwnedImage(tx, actor.user.id, input.imageUrl, 'SERVICE');
      const service = await tx.service.create({
        data: {
          name: input.name,
          description: input.description,
          basePriceMinor: input.basePriceMinor,
          imageUrl: input.imageUrl ?? null,
        },
        select: serviceSelect,
      });
      await this.audit.record(tx, {
        actorId: actor.user.id,
        action: 'SERVICE_CREATED',
        entityType: 'SERVICE',
        entityId: service.id,
        metadata: {
          basePriceMinor: service.basePriceMinor,
          currency: service.currency,
        },
      });
      await this.advanceRevision(tx);
      return serviceView(service);
    });
  }

  async update(actor: AuthActor, id: string, input: UpdateServiceInput) {
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.basePriceMinor !== undefined
        ? { basePriceMinor: input.basePriceMinor }
        : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      await requireActiveActor(tx, actor, [Role.ADMIN]);
      const previous = await this.lockActiveService(tx, id);
      await requireOwnedImage(tx, actor.user.id, input.imageUrl, 'SERVICE');
      const service = await tx.service.update({
        where: { id, deletedAt: null },
        data,
        select: serviceSelect,
      });
      await this.audit.record(tx, {
        actorId: actor.user.id,
        action: 'SERVICE_UPDATED',
        entityType: 'SERVICE',
        entityId: id,
        metadata: {
          updatedFields: Object.keys(data).filter(
            (field): field is keyof CreateServiceInput =>
              field === 'name' ||
              field === 'description' ||
              field === 'basePriceMinor' ||
              field === 'imageUrl',
          ),
          previousBasePriceMinor: previous.basePriceMinor,
          basePriceMinor: service.basePriceMinor,
        },
      });
      await this.advanceRevision(tx);
      return serviceView(service);
    });
  }

  async remove(actor: AuthActor, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await requireActiveActor(tx, actor, [Role.ADMIN]);
      await this.lockActiveService(tx, id);
      await tx.service.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.audit.record(tx, {
        actorId: actor.user.id,
        action: 'SERVICE_DELETED',
        entityType: 'SERVICE',
        entityId: id,
        metadata: {},
      });
      await this.advanceRevision(tx);
    });
  }

  private async lockActiveService(tx: Prisma.TransactionClient, id: string) {
    // Lock before reading the old price so audit snapshots remain correct under races.
    const rows = await tx.$queryRaw<
      Array<{ basePriceMinor: number }>
    >`SELECT "basePriceMinor" FROM "Service" WHERE id = ${id}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Service not found');
    return rows[0];
  }

  private advanceRevision(tx: Prisma.TransactionClient) {
    return tx.catalogRevision.update({
      where: { id: 1 },
      data: { revision: { increment: 1 } },
      select: { id: true },
    });
  }
}
