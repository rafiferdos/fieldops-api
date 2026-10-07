import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import {
  databaseErrorCode,
  serializable,
} from '../../common/database/serializable.js';
import type { AuthActor } from '../auth/auth.types.js';
import { lockRequest } from '../requests/request.lock.js';
import {
  activeWorkStatuses,
  assertVisitWindow,
  lockActiveServices,
  lockTechnicians,
} from './scheduling.policy.js';
import type { AssignmentInput, ScheduleInput } from './scheduling.schema.js';
import { workOrderSelect, workOrderView } from './work-order.select.js';

@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  assign(actor: AuthActor, requestId: string, input: AssignmentInput) {
    return this.schedulingTransaction(async (tx) => {
      const admin = await requireActiveActor(tx, actor, ['ADMIN']);
      const req = await lockRequest(tx, requestId);
      if (req.status !== 'APPROVED')
        throw new ConflictException('Only approved requests can be assigned');
      if (
        await tx.workOrder.findUnique({
          where: { requestId },
          select: { id: true },
        })
      )
        throw new ConflictException('This request already has a work order');
      const service = await this.validateBooking(tx, req.serviceId, input, [
        input.technicianId,
      ]);
      const order = await tx.workOrder.create({
        data: {
          requestId,
          technicianId: input.technicianId,
          scheduledStart: input.start,
          scheduledEnd: input.end,
          agreedPriceMinor: service.basePriceMinor,
          currency: service.currency,
        },
        select: workOrderSelect,
      });
      // Assignment changes the customer's cancellation context; require a fresh request version.
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        actorId: admin.id,
        entityType: 'WORK_ORDER',
        entityId: order.id,
        action: 'WORK_ORDER_ASSIGNED',
        metadata: {
          requestId,
          technicianId: input.technicianId,
          start: input.start.toISOString(),
          end: input.end.toISOString(),
          agreedPriceMinor: service.basePriceMinor,
          currency: 'BDT',
          version: 1,
        },
      });
      return this.view(tx, order.id);
    });
  }

  reschedule(actor: AuthActor, id: string, input: ScheduleInput) {
    return this.schedulingTransaction(async (tx) => {
      const admin = await requireActiveActor(tx, actor, ['ADMIN']);
      const order = await this.lockOrder(tx, id, admin);
      this.assertVersion(order.version, input.version);
      if (order.status !== 'ASSIGNED' || order.request.status !== 'APPROVED')
        throw new ConflictException(
          'Only unstarted assigned work can be rescheduled',
        );
      await this.validateBooking(
        tx,
        order.request.serviceId,
        input,
        [order.technicianId, input.technicianId],
        id,
      );
      await tx.workOrder.update({
        where: { id },
        data: {
          technicianId: input.technicianId,
          scheduledStart: input.start,
          scheduledEnd: input.end,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        actorId: admin.id,
        entityType: 'WORK_ORDER',
        entityId: id,
        action: 'WORK_ORDER_RESCHEDULED',
        metadata: {
          previousTechnicianId: order.technicianId,
          technicianId: input.technicianId,
          start: input.start.toISOString(),
          end: input.end.toISOString(),
          previousStart: order.scheduledStart.toISOString(),
          previousEnd: order.scheduledEnd.toISOString(),
          previousVersion: order.version,
          version: order.version + 1,
        },
      });
      return this.view(tx, id);
    });
  }

  private async validateBooking(
    tx: Prisma.TransactionClient,
    serviceId: string,
    input: AssignmentInput,
    technicianIds: readonly [string, ...string[]],
    excludedId?: string,
  ) {
    const technicians = await lockTechnicians(tx, technicianIds);
    const technician = technicians.find((row) => row.id === input.technicianId);
    if (
      !technician ||
      technician.role !== 'TECHNICIAN' ||
      technician.status !== 'ACTIVE' ||
      technician.deletedAt
    )
      throw new NotFoundException('Active technician not found');
    const [service] = await lockActiveServices(tx, [serviceId]);
    if (!service) throw new NotFoundException('Service not found');
    if (
      !(await tx.technicianSkill.findUnique({
        where: { userId_serviceId: { userId: input.technicianId, serviceId } },
        select: { userId: true },
      }))
    )
      throw new ConflictException(
        'Technician does not have the required skill',
      );
    assertVisitWindow(input.start, input.end);
    const overlap = await tx.workOrder.findFirst({
      where: {
        technicianId: input.technicianId,
        ...(excludedId ? { id: { not: excludedId } } : {}),
        status: { in: [...activeWorkStatuses] },
        scheduledStart: { lt: input.end },
        scheduledEnd: { gt: input.start },
      },
      select: { id: true },
    });
    if (overlap)
      throw new ConflictException('Technician has an overlapping visit');
    return service;
  }

  private async schedulingTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await serializable(this.prisma, work);
    } catch (error) {
      if (
        databaseErrorCode(error) === '23P01' ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      )
        throw new ConflictException(
          'Request already assigned or technician has an overlapping visit',
        );
      throw error;
    }
  }

  private scope(user: { id: string; role: Role }): Prisma.WorkOrderWhereInput {
    return {
      request: {
        deletedAt: null,
        ...(user.role === 'CUSTOMER' ? { customerId: user.id } : {}),
      },
      ...(user.role === 'TECHNICIAN' ? { technicianId: user.id } : {}),
    };
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    id: string,
    user: { id: string; role: Role },
  ) {
    // Check scope before locking/revealing state. Re-check after waiting for possible reassignment.
    const visible = await tx.workOrder.findFirst({
      where: { id, ...this.scope(user) },
      select: { requestId: true },
    });
    if (!visible) throw new NotFoundException('Work order not found');
    await lockRequest(
      tx,
      visible.requestId,
      user.role === 'CUSTOMER' ? user.id : undefined,
    );
    await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.workOrder.findFirst({
      where: { id, ...this.scope(user) },
      select: workOrderSelect,
    });
    if (!order) throw new NotFoundException('Work order not found');
    return order;
  }

  private assertVersion(current: number, expected: number) {
    if (current !== expected)
      throw new ConflictException(
        'Work order changed; fetch the latest version and retry',
      );
  }
  private async view(tx: Prisma.TransactionClient, id: string) {
    return workOrderView(
      await tx.workOrder.findUniqueOrThrow({
        where: { id },
        select: workOrderSelect,
      }),
    );
  }
}
