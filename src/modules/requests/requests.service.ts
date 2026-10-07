import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { pagination } from '../../common/http/pagination.js';
import { literalSearch } from '../../common/validation/literal-search.js';
import type { AuthActor } from '../auth/auth.types.js';
import type {
  CreateRequestInput,
  RequestQuery,
} from './schemas/request.schema.js';
import { requestSelect, requestView } from './request.select.js';

@Injectable()
export class RequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(actor: AuthActor, input: CreateRequestInput) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await requireActiveActor(tx, actor, [Role.CUSTOMER]);
      this.assertPreferredStart(input.preferredStart);
      // Serializes acceptance with catalog delete/update; never trust cached catalog state.
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Service" WHERE id = ${input.serviceId}::uuid AND "deletedAt" IS NULL FOR SHARE`;
      if (!active[0]) throw new NotFoundException('Service not found');
      const request = await tx.serviceRequest.create({
        data: {
          customerId: customer.id,
          serviceId: input.serviceId,
          description: input.description,
          address: input.address,
          preferredStart: input.preferredStart,
        },
        select: requestSelect,
      });
      await this.audit.record(tx, {
        actorId: customer.id,
        entityId: request.id,
        entityType: 'REQUEST',
        action: 'REQUEST_CREATED',
        metadata: { serviceId: input.serviceId, status: 'PENDING', version: 1 },
      });
      return requestView(request);
    });
  }

  async list(actor: AuthActor, query: RequestQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await requireActiveActor(tx, actor, [
          Role.CUSTOMER,
          Role.ADMIN,
        ]);
        const search = literalSearch(query.q);
        const where: Prisma.ServiceRequestWhereInput = {
          ...this.scope(user),
          ...(query.status ? { status: query.status } : {}),
          ...(query.serviceId ? { serviceId: query.serviceId } : {}),
          ...(search
            ? {
                OR: [
                  { description: { contains: search, mode: 'insensitive' } },
                  { address: { contains: search, mode: 'insensitive' } },
                  {
                    service: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                ],
              }
            : {}),
        };
        const orders: Record<
          RequestQuery['sort'],
          Prisma.ServiceRequestOrderByWithRelationInput[]
        > = {
          newest: [{ createdAt: 'desc' }, { id: 'asc' }],
          oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
          preferred_start_asc: [{ preferredStart: 'asc' }, { id: 'asc' }],
        };
        const requests = await tx.serviceRequest.findMany({
          where,
          select: requestSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: orders[query.sort],
        });
        const total = await tx.serviceRequest.count({ where });
        return {
          items: requests.map(requestView),
          pagination: pagination(total, query),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async detail(actor: AuthActor, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await requireActiveActor(tx, actor, [
          Role.CUSTOMER,
          Role.ADMIN,
        ]);
        const request = await tx.serviceRequest.findFirst({
          where: { id, ...this.scope(user) },
          select: requestSelect,
        });
        if (!request) throw new NotFoundException('Request not found');
        return requestView(request);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private scope(user: {
    id: string;
    role: Role;
  }): Prisma.ServiceRequestWhereInput {
    return {
      deletedAt: null,
      ...(user.role === Role.CUSTOMER ? { customerId: user.id } : {}),
    };
  }

  private assertPreferredStart(value: Date) {
    if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now())
      throw new BadRequestException('preferredStart must be in the future');
  }
}
