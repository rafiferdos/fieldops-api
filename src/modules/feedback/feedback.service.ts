import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthActor } from '../auth/auth.types.js';
import { lockRequest } from '../requests/request.lock.js';
import type { FeedbackInput } from './feedback.schema.js';
import { feedbackSelect, feedbackView } from './feedback.select.js';

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async submit(actor: AuthActor, workOrderId: string, input: FeedbackInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await requireActiveActor(tx, actor, ['CUSTOMER']);
        const scope = {
          id: workOrderId,
          request: { customerId: customer.id, deletedAt: null },
        };
        const visible = await tx.workOrder.findFirst({
          where: scope,
          select: { requestId: true },
        });
        if (!visible) throw new NotFoundException('Work order not found');

        // Match lifecycle writers: request -> work order. Competing submissions serialize here.
        await lockRequest(tx, visible.requestId, customer.id);
        await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${workOrderId}::uuid FOR UPDATE`;
        // Waiting on a lifecycle lock must not keep a revoked/suspended actor authorized.
        await requireActiveActor(tx, actor, ['CUSTOMER']);
        const order = await tx.workOrder.findFirst({
          where: scope,
          select: {
            status: true,
            invoice: { select: { status: true } },
            feedback: { select: { id: true } },
          },
        });
        if (!order) throw new NotFoundException('Work order not found');
        if (order.status !== 'COMPLETED' || order.invoice?.status !== 'PAID')
          throw new ConflictException(
            'Feedback requires completed work with a paid invoice',
          );
        if (order.feedback)
          throw new ConflictException(
            'Feedback has already been submitted for this work order',
          );

        const feedback = await tx.feedback.create({
          data: {
            workOrderId,
            customerId: customer.id,
            rating: input.rating,
            comment: input.comment ?? null,
          },
          select: feedbackSelect,
        });
        await this.audit.record(tx, {
          actorId: customer.id,
          entityType: 'WORK_ORDER',
          entityId: workOrderId,
          action: 'FEEDBACK_SUBMITTED',
          metadata: { feedbackId: feedback.id, rating: feedback.rating },
        });
        return feedbackView(feedback);
      });
    } catch (error) {
      // The unique index also protects against a competing writer outside this service.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Feedback has already been submitted for this work order',
        );
      throw error;
    }
  }
}
