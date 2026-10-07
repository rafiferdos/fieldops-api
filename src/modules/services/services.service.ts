import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { Role, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
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
  ) {}

  async create(actor: AuthActor, input: CreateServiceInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(tx, actor);
      const service = await tx.service.create({
        data: {
          name: input.name,
          description: input.description,
          basePriceMinor: input.basePriceMinor,
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
    };
    return this.prisma.$transaction(async (tx) => {
      await this.assertAdmin(tx, actor);
      const previous = await this.lockActiveService(tx, id);
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
              field === 'basePriceMinor',
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
      await this.assertAdmin(tx, actor);
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

  private async assertAdmin(tx: Prisma.TransactionClient, actor: AuthActor) {
    const user = await tx.user.findFirst({
      where: {
        id: actor.user.id,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        sessions: {
          some: {
            id: actor.sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        },
      },
      select: { role: true },
    });
    if (!user)
      throw new UnauthorizedException('Account or session is unavailable');
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Only administrators can manage services');
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
