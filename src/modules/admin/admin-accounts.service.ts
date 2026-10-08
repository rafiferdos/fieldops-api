import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import {
  activeWorkStatuses,
  lockTechnicians,
} from '../work-orders/scheduling.policy.js';
import type { AuthActor } from '../auth/auth.types.js';
import type { UpdateAccessInput } from './admin.schema.js';
import { adminUserSelect } from './admin.service.js';

@Injectable()
export class AdminAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  updateAccess(actor: AuthActor, id: string, input: UpdateAccessInput) {
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize the cross-account last-admin invariant before locking the target.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('fieldops-admin-access', 0))::text`;
        await requireActiveActor(tx, actor, ['ADMIN']);
        // Share the same User lock as skill and assignment writers.
        const [current] = await lockTechnicians(tx, [id]);
        if (!current || current.deletedAt)
          throw new NotFoundException('User not found');
        const role = input.role ?? current.role;
        const status = input.status ?? current.status;
        if (role === current.role && status === current.status)
          return tx.user.findUniqueOrThrow({
            where: { id },
            select: adminUserSelect,
          });

        if (
          current.role === 'TECHNICIAN' &&
          role !== 'TECHNICIAN' &&
          (await tx.workOrder.count({
            where: {
              technicianId: id,
              status: { in: [...activeWorkStatuses] },
            },
          }))
        )
          throw new ConflictException(
            'Reassign active work before changing the technician role',
          );

        if (
          current.role === 'ADMIN' &&
          current.status === 'ACTIVE' &&
          (role !== 'ADMIN' || status !== 'ACTIVE') &&
          (await tx.user.count({
            where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
          })) <= 1
        )
          throw new ConflictException(
            'At least one active administrator must remain',
          );

        const user = await tx.user.update({
          where: { id },
          data: { role, status },
          select: adminUserSelect,
        });
        if (current.role === 'TECHNICIAN' && role !== 'TECHNICIAN')
          await tx.technicianSkill.deleteMany({ where: { userId: id } });
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record(tx, {
          actorId: actor.user.id,
          entityType: 'USER',
          entityId: id,
          action: 'USER_ACCESS_UPDATED',
          metadata: {
            previousRole: current.role,
            role,
            previousStatus: current.status,
            status,
          },
        });
        return user;
        // Fresh statement snapshots see sessions committed by a login while the
        // User lock was being acquired; the advisory/row locks protect invariants.
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 },
    );
  }
}
