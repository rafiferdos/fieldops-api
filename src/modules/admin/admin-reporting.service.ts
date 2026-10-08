import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import type { AuthActor } from '../auth/auth.types.js';
import type { OverviewQuery } from './admin.schema.js';

@Injectable()
export class AdminReportingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  overview(actor: AuthActor, query: OverviewQuery) {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * 86400000);
    return this.prisma.$transaction(
      async (tx) => {
        await requireActiveActor(tx, actor, ['ADMIN']);
        const requests = await tx.serviceRequest.groupBy({
          by: ['status'],
          where: { deletedAt: null, createdAt: { gte: from, lt: to } },
          _count: { _all: true },
        });
        const work = await tx.workOrder.groupBy({
          by: ['status'],
          where: { createdAt: { gte: from, lt: to } },
          _count: { _all: true },
        });
        const total = work.reduce((sum, row) => sum + row._count._all, 0);
        const completed =
          work.find((row) => row.status === 'COMPLETED')?._count._all ?? 0;
        const paidCount = await tx.invoice.count({
          where: { status: 'PAID', paidAt: { gte: from, lt: to } },
        });
        // SUM(int) can exceed JavaScript's safe integer range; serialize the exact DB total.
        const [revenue] = await tx.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM("amountMinor"), 0)::text AS total FROM "Invoice"
        WHERE status = 'PAID' AND "paidAt" >= ${from} AND "paidAt" < ${to}`;
        const technicians = await tx.user.groupBy({
          by: ['status'],
          where: { role: 'TECHNICIAN', deletedAt: null },
          _count: { _all: true },
        });
        return {
          period: { from, to },
          requests: {
            total: requests.reduce((sum, row) => sum + row._count._all, 0),
            byStatus: Object.fromEntries(
              requests.map((row) => [row.status, row._count._all]),
            ),
          },
          workOrders: {
            total,
            completed,
            completionRate: total
              ? Math.round((completed / total) * 10000) / 100
              : 0,
          },
          invoices: {
            paidCount,
            verifiedRevenueMinor: revenue.total,
            currency: 'BDT' as const,
          },
          technicians: {
            total: technicians.reduce((sum, row) => sum + row._count._all, 0),
            active:
              technicians.find((row) => row.status === 'ACTIVE')?._count._all ??
              0,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
