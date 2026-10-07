import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import type { AuthActor } from '../auth/auth.types.js';
import { invoiceSelect, invoiceView } from './invoice.select.js';

@Injectable()
export class InvoicesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  detail(actor: AuthActor, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await requireActiveActor(tx, actor, ['CUSTOMER', 'ADMIN']);
        // Invoice ownership is frozen. Financial history survives catalog/request soft deletion.
        const invoice = await tx.invoice.findFirst({
          where: {
            id,
            ...(user.role === 'CUSTOMER' ? { customerId: user.id } : {}),
          },
          select: invoiceSelect,
        });
        if (!invoice) throw new NotFoundException('Invoice not found');
        return invoiceView(invoice);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
