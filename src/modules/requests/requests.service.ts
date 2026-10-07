import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { Role, RequestStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { pagination } from '../../common/http/pagination.js';
import { literalSearch } from '../../common/validation/literal-search.js';
import type { AuthActor } from '../auth/auth.types.js';
import type {
  CreateRequestInput,
  RequestQuery,
  UpdateRequestInput,
  ReviewRequestInput,
  CancelRequestInput,
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
      // Serializes acceptance with catalog delete/update; never trust cached catalog state.
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Service" WHERE id = ${input.serviceId}::uuid AND "deletedAt" IS NULL FOR SHARE`;
      if (!active[0]) throw new NotFoundException('Service not found');
      this.assertPreferredStart(input.preferredStart);
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

  async update(actor: AuthActor, id: string, input: UpdateRequestInput) {
    const data = {
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.preferredStart !== undefined
        ? { preferredStart: input.preferredStart }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const customer = await requireActiveActor(tx, actor, [Role.CUSTOMER]);
      const current = await this.lockRequest(tx, customer, id);
      this.assertVersion(current.version, input.version);
      if (current.status !== RequestStatus.PENDING)
        throw new ConflictException('Only pending requests can be edited');
      if (input.preferredStart !== undefined)
        this.assertPreferredStart(input.preferredStart);
      const changed = await tx.serviceRequest.updateMany({
        where: {
          id,
          customerId: customer.id,
          status: RequestStatus.PENDING,
          version: input.version,
          deletedAt: null,
        },
        data: { ...data, version: { increment: 1 } },
      });
      this.assertChanged(changed.count);
      await this.audit.record(tx, {
        actorId: customer.id,
        entityType: 'REQUEST',
        entityId: id,
        action: 'REQUEST_UPDATED',
        metadata: {
          updatedFields: Object.keys(data).filter(
            (field): field is 'description' | 'address' | 'preferredStart' =>
              field === 'description' ||
              field === 'address' ||
              field === 'preferredStart',
          ),
          previousVersion: current.version,
          version: current.version + 1,
        },
      });
      return this.viewInTransaction(tx, id);
    });
  }

  async review(actor: AuthActor, id: string, input: ReviewRequestInput) {
    return this.prisma.$transaction(async (tx) => {
      const admin = await requireActiveActor(tx, actor, [Role.ADMIN]);
      const current = await this.lockRequest(tx, admin, id);
      this.assertVersion(current.version, input.version);
      if (current.status !== RequestStatus.PENDING)
        throw new ConflictException('Only pending requests can be reviewed');
      const status =
        input.decision === 'APPROVE'
          ? RequestStatus.APPROVED
          : RequestStatus.REJECTED;
      const changed = await tx.serviceRequest.updateMany({
        where: {
          id,
          status: RequestStatus.PENDING,
          version: input.version,
          deletedAt: null,
        },
        data: {
          status,
          reviewReason: input.reason ?? null,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count);
      await this.audit.record(tx, {
        actorId: admin.id,
        entityType: 'REQUEST',
        entityId: id,
        action: 'REQUEST_REVIEWED',
        metadata: {
          fromStatus: 'PENDING',
          toStatus: status,
          previousVersion: current.version,
          version: current.version + 1,
        },
      });
      return this.viewInTransaction(tx, id);
    });
  }

  async cancel(actor: AuthActor, id: string, input: CancelRequestInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await requireActiveActor(tx, actor, [
        Role.CUSTOMER,
        Role.ADMIN,
      ]);
      const current = await this.lockRequest(tx, user, id);
      this.assertVersion(current.version, input.version);
      if (
        current.status !== RequestStatus.PENDING &&
        current.status !== RequestStatus.APPROVED
      )
        throw new ConflictException(
          'Only pending or approved requests can be cancelled',
        );
      // Future assignment/progress must lock this request first and cancel linked unstarted work atomically.
      const changed = await tx.serviceRequest.updateMany({
        where: {
          id,
          ...this.scope(user),
          status: current.status,
          version: input.version,
        },
        data: {
          status: RequestStatus.CANCELLED,
          cancellationReason: input.reason,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      this.assertChanged(changed.count);
      await this.audit.record(tx, {
        actorId: user.id,
        entityType: 'REQUEST',
        entityId: id,
        action: 'REQUEST_CANCELLED',
        metadata: {
          fromStatus: current.status,
          toStatus: 'CANCELLED',
          previousVersion: current.version,
          version: current.version + 1,
        },
      });
      return this.viewInTransaction(tx, id);
    });
  }

  private async lockRequest(
    tx: Prisma.TransactionClient,
    user: { id: string; role: Role },
    id: string,
  ) {
    // All request transitions share one lock; scope is checked before revealing version or state.
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: RequestStatus; version: number }>
    >`
      SELECT id, status, version FROM "ServiceRequest"
      WHERE id = ${id}::uuid AND "deletedAt" IS NULL
        AND (${user.role === Role.ADMIN} OR "customerId" = ${user.id}::uuid)
      FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Request not found');
    return rows[0];
  }

  private assertVersion(current: number, expected: number) {
    if (current !== expected)
      throw new ConflictException(
        'Request changed; fetch the latest version and retry',
      );
  }

  private assertChanged(count: number) {
    if (count !== 1)
      throw new ConflictException(
        'Request changed; fetch the latest version and retry',
      );
  }

  private async viewInTransaction(tx: Prisma.TransactionClient, id: string) {
    return requestView(
      await tx.serviceRequest.findUniqueOrThrow({
        where: { id },
        select: requestSelect,
      }),
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
