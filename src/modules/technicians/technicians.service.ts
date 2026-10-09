import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { serializable } from '../../common/database/serializable.js';
import { pagination } from '../../common/http/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthActor } from '../auth/auth.types.js';
import {
  activeWorkStatuses,
  assertVisitWindow,
  lockActiveServices,
  lockTechnicians,
} from '../work-orders/scheduling.policy.js';
import type {
  SkillsInput,
  AvailabilityQuery,
} from '../work-orders/scheduling.schema.js';

@Injectable()
export class TechniciansService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  currentSkills(actor: AuthActor, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await requireActiveActor(tx, actor, ['ADMIN']);
        const technician = await tx.user.findFirst({
          where: { id, role: 'TECHNICIAN', deletedAt: null },
          select: {
            id: true,
            technicianSkills: {
              orderBy: { serviceId: 'asc' },
              select: {
                service: { select: { id: true, name: true, deletedAt: true } },
              },
            },
          },
        });
        if (!technician) throw new NotFoundException('Technician not found');
        // Retain deleted service identities so an editor never silently clears unknown skills.
        const services = technician.technicianSkills.map(({ service }) => ({
          id: service.id,
          name: service.name,
          active: service.deletedAt === null,
        }));
        return {
          technicianId: technician.id,
          serviceIds: services.map((service) => service.id),
          services,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  replaceSkills(actor: AuthActor, id: string, input: SkillsInput) {
    return serializable(this.prisma, async (tx) => {
      const admin = await requireActiveActor(tx, actor, ['ADMIN']);
      const [technician] = await lockTechnicians(tx, [id]);
      if (
        !technician ||
        technician.role !== 'TECHNICIAN' ||
        technician.deletedAt
      )
        throw new NotFoundException('Technician not found');
      if (input.expectedServiceIds !== undefined) {
        const current = await tx.technicianSkill.findMany({
          where: { userId: id },
          select: { serviceId: true },
        });
        // Compare while holding the same technician lock used by dispatch and all skill writers.
        const expected = new Set(input.expectedServiceIds);
        if (
          current.length !== expected.size ||
          current.some(({ serviceId }) => !expected.has(serviceId))
        )
          throw new ConflictException(
            'Technician skills changed; inspect the latest skills before replacing them',
          );
      }
      await lockActiveServices(tx, input.serviceIds);
      const required = await tx.workOrder.findMany({
        where: { technicianId: id, status: { in: [...activeWorkStatuses] } },
        select: { request: { select: { serviceId: true } } },
      });
      if (
        required.some(
          (order) => !input.serviceIds.includes(order.request.serviceId),
        )
      )
        throw new ConflictException(
          'A skill required by active work cannot be removed',
        );
      await tx.technicianSkill.deleteMany({ where: { userId: id } });
      if (input.serviceIds.length)
        await tx.technicianSkill.createMany({
          data: input.serviceIds.map((serviceId) => ({
            userId: id,
            serviceId,
          })),
        });
      const serviceIds = [...input.serviceIds].sort();
      await this.audit.record(tx, {
        actorId: admin.id,
        entityType: 'USER',
        entityId: id,
        action: 'TECHNICIAN_SKILLS_UPDATED',
        metadata: { serviceIds },
      });
      return { technicianId: id, serviceIds };
    });
  }

  availability(actor: AuthActor, query: AvailabilityQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        await requireActiveActor(tx, actor, ['ADMIN']);
        const service = await tx.service.findFirst({
          where: { id: query.serviceId, deletedAt: null },
          select: { id: true },
        });
        if (!service) throw new NotFoundException('Service not found');
        assertVisitWindow(query.start, query.end);
        const where: Prisma.UserWhereInput = {
          role: 'TECHNICIAN',
          status: 'ACTIVE',
          deletedAt: null,
          technicianSkills: { some: { serviceId: query.serviceId } },
          workOrders: {
            none: {
              status: { in: [...activeWorkStatuses] },
              scheduledStart: { lt: query.end },
              scheduledEnd: { gt: query.start },
            },
          },
        };
        const items = await tx.user.findMany({
          where,
          select: { id: true, name: true },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
        return {
          items,
          pagination: pagination(await tx.user.count({ where }), query),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
