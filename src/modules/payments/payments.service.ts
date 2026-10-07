import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SslCommerzService } from '../../infrastructure/sslcommerz/sslcommerz.service.js';
import type { CheckoutResult } from '../../infrastructure/sslcommerz/sslcommerz.types.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { lockInvoice, lockPayment } from './payment.lock.js';
import type { PaymentSessionInput } from './payment.schema.js';
import { paymentSelect, paymentView } from './payment.select.js';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SslCommerzService) private readonly gateway: SslCommerzService,
    @Inject(PaymentSettlementService)
    private readonly settlements: PaymentSettlementService,
  ) {}

  detail(actor: AuthActor, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await requireActiveActor(tx, actor, ['CUSTOMER', 'ADMIN']);
        const row = await tx.payment.findFirst({
          where: {
            id,
            ...(user.role === 'CUSTOMER' ? { userId: user.id } : {}),
          },
          select: paymentSelect,
        });
        if (!row) throw new NotFoundException('Payment not found');
        return paymentView(row);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async createSession(
    actor: AuthActor,
    invoiceId: string,
    key: string,
    input: PaymentSessionInput,
  ) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          invoiceId,
          address: input.billing.address,
          city: input.billing.city,
          postcode: input.billing.postcode,
        }),
      )
      .digest('hex');
    const reservation = await this.prisma.$transaction(
      async (tx) => {
        const user = await requireActiveActor(tx, actor, ['CUSTOMER']);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'payment-key:' + user.id + ':' + key}, 0))::text`;
        const bill = await lockInvoice(tx, invoiceId, user.id);
        const existing = await tx.payment.findUnique({
          where: {
            userId_idempotencyKey: { userId: user.id, idempotencyKey: key },
          },
          select: { ...paymentSelect, requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== hash)
            throw new ConflictException(
              'Idempotency-Key already belongs to a different request',
            );
          return { created: false as const, payment: paymentView(existing) };
        }
        if (bill.status !== 'UNPAID')
          throw new ConflictException('Invoice is already paid');
        if (bill.amountMinor < 1000 || bill.amountMinor > 50_000_000)
          throw new ConflictException(
            'SSLCommerz supports invoices from BDT 10 to BDT 500,000',
          );
        const live = await tx.payment.findFirst({
          where: {
            invoiceId,
            status: { in: ['INITIATING', 'PENDING', 'UNKNOWN', 'REVIEW'] },
          },
          select: { id: true },
        });
        if (live)
          throw new ConflictException(
            'Invoice already has an active or unresolved payment; reuse its Idempotency-Key',
          );
        const profile = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { name: true, email: true, phone: true },
        });
        if (!profile.phone || !/^\+[1-9]\d{1,14}$/.test(profile.phone))
          throw new ConflictException(
            'Add an international phone number to your profile before paying',
          );
        if (profile.name.length > 50 || profile.email.length > 50)
          throw new ConflictException(
            'Gateway customer name and email must each fit within 50 characters',
          );
        const identity = this.gateway.identity();
        const row = await tx.payment.create({
          data: {
            invoiceId,
            userId: user.id,
            ...identity,
            merchantTranId: randomBytes(12).toString('hex'),
            amountMinor: bill.amountMinor,
            currency: bill.currency,
            idempotencyKey: key,
            requestHash: hash,
          },
        });
        await this.audit.record(tx, {
          actorId: user.id,
          entityId: row.id,
          entityType: 'PAYMENT',
          action: 'PAYMENT_INITIATED',
          metadata: {
            invoiceId,
            amountMinor: row.amountMinor,
            currency: 'BDT',
            status: 'INITIATING',
          },
        });
        return {
          created: true as const,
          row,
          customer: {
            name: profile.name,
            email: profile.email,
            phone: profile.phone,
            ...input.billing,
          },
        };
      },
      { maxWait: 5000, timeout: 10000 },
    );
    if (!reservation.created) {
      // Never repeat initiation. Query the durable merchant ID after the original network window.
      const existing = reservation.payment;
      if (
        ['INITIATING', 'UNKNOWN', 'PENDING'].includes(existing.status) &&
        Date.now() - new Date(existing.createdAt).getTime() >= 15_000
      ) {
        await this.settlements.reconcile(existing.id);
        return {
          created: false,
          payment: await this.detail(actor, existing.id),
        };
      }
      return { created: false, payment: existing };
    }
    let result: CheckoutResult;
    try {
      result = await this.gateway.initiate({
        ...reservation.row,
        customer: reservation.customer,
      });
    } catch {
      const payment = await this.saveInitiation(reservation.row.id, 'UNKNOWN');
      if (payment.status === 'SUCCEEDED')
        return { created: true, payment: await this.detail(actor, payment.id) };
      throw new BadGatewayException(
        'Payment initiation is uncertain; reuse the same Idempotency-Key and reconcile this attempt before creating another',
      );
    }
    const payment = await this.saveInitiation(reservation.row.id, result);
    if (result.kind === 'rejected' && payment.status === 'FAILED')
      throw new BadGatewayException(
        'Payment gateway rejected session creation; a new key may be used',
      );
    return { created: true, payment: await this.detail(actor, payment.id) };
  }

  private saveInitiation(id: string, result: CheckoutResult | 'UNKNOWN') {
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.payment.findUniqueOrThrow({
          where: { id },
          select: { invoiceId: true },
        });
        await lockInvoice(tx, initial.invoiceId);
        const row = await lockPayment(tx, id);
        // An early callback can win before the initiation response reaches this server.
        if (['INITIATING', 'UNKNOWN'].includes(row.status)) {
          const status =
            result === 'UNKNOWN'
              ? 'UNKNOWN'
              : result.kind === 'ready'
                ? 'PENDING'
                : 'FAILED';
          await tx.payment.update({
            where: { id },
            data: {
              status,
              ...(result !== 'UNKNOWN' && result.kind === 'ready'
                ? {
                    sessionKey: result.sessionKey,
                    checkoutUrl: result.checkoutUrl,
                  }
                : {}),
              ...(status === 'FAILED' ? { verifiedAt: new Date() } : {}),
            },
          });
          await this.audit.record(tx, {
            actorId: null,
            entityId: id,
            entityType: 'PAYMENT',
            action: 'PAYMENT_STATE_CHANGED',
            metadata: {
              invoiceId: row.invoiceId,
              fromStatus: row.status,
              toStatus: status,
            },
          });
        }
        return paymentView(
          await tx.payment.findUniqueOrThrow({
            where: { id },
            select: paymentSelect,
          }),
        );
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }
}
