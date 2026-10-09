import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SslCommerzService } from '../../infrastructure/sslcommerz/sslcommerz.service.js';
import type {
  GatewayObservation,
  VerifiedCharge,
} from '../../infrastructure/sslcommerz/sslcommerz.types.js';
import { lockInvoice, lockPayment } from './payment.lock.js';
import type { PaymentCallback } from './payment.schema.js';
import { paymentSelect, paymentView } from './payment.select.js';

const evidenceSelect = {
  id: true,
  invoiceId: true,
  merchantTranId: true,
  gatewayMode: true,
  gatewayStoreId: true,
  sessionKey: true,
  amountMinor: true,
} satisfies Prisma.PaymentSelect;
type Attempt = Prisma.PaymentGetPayload<{ select: typeof evidenceSelect }>;
type ReviewReason =
  | 'HIGH_RISK'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_CHARGE'
  | 'MULTIPLE_CHARGES'
  | 'PROVIDER_REUSED'
  | 'PAYMENT_UNDER_REVIEW';

@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SslCommerzService) private readonly gateway: SslCommerzService,
  ) {}

  // Resolve only our stored attempt; callback-supplied IDs never become redirect destinations.
  async callbackPaymentId(merchantTranId: string) {
    const row = await this.prisma.payment.findUnique({
      where: { merchantTranId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Payment not found');
    return row.id;
  }

  async callback(
    input: PaymentCallback,
    kind: 'ipn' | 'success' | 'fail' | 'cancel',
  ) {
    const row = await this.prisma.payment.findUnique({
      where: { merchantTranId: input.tran_id },
      select: evidenceSelect,
    });
    if (!row) throw new NotFoundException('Payment not found');
    // The callback's claimed status, price, risk, store and bank transaction are never authoritative.
    const observation: GatewayObservation =
      input.val_id && (kind === 'success' || kind === 'ipn')
        ? {
            charges: [await this.gateway.validate(row, input.val_id)],
            terminal: null,
          }
        : await this.gateway.lookup(row);
    await this.apply(row, observation);
    // Correlate real callback delivery only after verification and commit; omit provider secrets.
    this.logger.log(`Payment notification verified: ${kind} ${row.id}`);
  }
  async reconcile(id: string) {
    const row = await this.prisma.payment.findUnique({
      where: { id },
      select: evidenceSelect,
    });
    if (!row) throw new NotFoundException('Payment not found');
    return this.apply(row, await this.gateway.lookup(row));
  }
  private apply(attempt: Attempt, observation: GatewayObservation) {
    if (
      observation.charges.some(
        (charge) => charge.merchantTranId !== attempt.merchantTranId,
      )
    )
      throw new BadGatewayException(
        'Verified transaction does not match this payment',
      );
    const byProvider = new Map<string, VerifiedCharge>();
    for (const charge of observation.charges) {
      const previous = byProvider.get(charge.providerTranId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(charge))
        throw new BadGatewayException(
          'Gateway returned contradictory transaction evidence',
        );
      byProvider.set(charge.providerTranId, charge);
    }
    const charges = [...byProvider.values()];
    return this.prisma.$transaction(
      async (tx) => {
        const bill = await lockInvoice(tx, attempt.invoiceId);
        // Serialize bank/validation identities across invoices as well as within one invoice.
        const identities = [
          ...new Set(
            charges.flatMap((charge) => [
              `bank:${charge.providerTranId}`,
              `validation:${charge.validationId}`,
            ]),
          ),
        ].sort();
        for (const identity of identities)
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'payment-evidence:' + identity}, 0))::text`;
        let row = await lockPayment(tx, attempt.id);
        for (const charge of charges) {
          const existing = await tx.paymentReceipt.findMany({
            where: {
              OR: [
                { providerTranId: charge.providerTranId },
                { validationId: charge.validationId },
              ],
            },
          });
          if (existing.length) {
            const receipt = existing[0]!;
            if (
              existing.length !== 1 ||
              receipt.paymentId !== row.id ||
              receipt.providerTranId !== charge.providerTranId ||
              receipt.validationId !== charge.validationId
            ) {
              row = await this.review(tx, row, 'PROVIDER_REUSED');
            } else if (
              receipt.amountMinor !== charge.amountMinor ||
              receipt.currency !== charge.currency ||
              receipt.originalAmountMinor !== charge.originalAmountMinor ||
              receipt.originalCurrency !== charge.originalCurrency ||
              receipt.risky !== charge.risky
            ) {
              throw new BadGatewayException(
                'Gateway verification contradicts an immutable receipt',
              );
            }
            continue;
          }
          const reason: ReviewReason | null = charge.risky
            ? 'HIGH_RISK'
            : charge.currency !== 'BDT' || charge.originalCurrency !== 'BDT'
              ? 'CURRENCY_MISMATCH'
              : charge.amountMinor !== bill.amountMinor ||
                  charge.originalAmountMinor !== bill.amountMinor
                ? 'AMOUNT_MISMATCH'
                : bill.status === 'PAID' || row.status === 'SUCCEEDED'
                  ? 'DUPLICATE_CHARGE'
                  : charges.length > 1
                    ? 'MULTIPLE_CHARGES'
                    : row.status === 'REVIEW'
                      ? 'PAYMENT_UNDER_REVIEW'
                      : null;
          const receipt = await tx.paymentReceipt.create({
            data: {
              paymentId: row.id,
              providerTranId: charge.providerTranId,
              validationId: charge.validationId,
              amountMinor: charge.amountMinor,
              currency: charge.currency,
              originalAmountMinor: charge.originalAmountMinor,
              originalCurrency: charge.originalCurrency,
              risky: charge.risky,
              disposition: reason ? 'REVIEW' : 'SETTLED',
              reviewReason: reason,
            },
          });
          if (reason) {
            row = await this.review(tx, row, reason);
            await this.audit.record(tx, {
              actorId: null,
              entityType: 'PAYMENT',
              entityId: row.id,
              action: 'PAYMENT_RECEIPT_REVIEW',
              metadata: {
                invoiceId: row.invoiceId,
                receiptId: receipt.id,
                reason,
              },
            });
            continue;
          }
          const now = new Date();
          row = await tx.payment.update({
            where: { id: row.id },
            data: {
              status: 'SUCCEEDED',
              providerTranId: charge.providerTranId,
              verifiedAt: now,
              settledAt: now,
              reviewReason: null,
            },
          });
          await tx.invoice.update({
            where: { id: bill.id },
            data: { status: 'PAID', paidAt: now },
          });
          bill.status = 'PAID';
          await this.audit.record(tx, {
            actorId: null,
            entityType: 'PAYMENT',
            entityId: row.id,
            action: 'PAYMENT_SETTLED',
            metadata: {
              invoiceId: bill.id,
              receiptId: receipt.id,
              amountMinor: bill.amountMinor,
              currency: 'BDT',
            },
          });
          await this.audit.record(tx, {
            actorId: null,
            entityType: 'INVOICE',
            entityId: bill.id,
            action: 'INVOICE_PAID',
            metadata: {
              paymentId: row.id,
              amountMinor: bill.amountMinor,
              currency: 'BDT',
            },
          });
        }
        if (
          !charges.length &&
          observation.terminal &&
          !['SUCCEEDED', 'REVIEW', 'FAILED', 'CANCELLED'].includes(row.status)
        ) {
          await tx.payment.update({
            where: { id: row.id },
            data: { status: observation.terminal, verifiedAt: new Date() },
          });
          await this.audit.record(tx, {
            actorId: null,
            entityType: 'PAYMENT',
            entityId: row.id,
            action: 'PAYMENT_STATE_CHANGED',
            metadata: {
              invoiceId: row.invoiceId,
              fromStatus: row.status,
              toStatus: observation.terminal,
            },
          });
        }
        return paymentView(
          await tx.payment.findUniqueOrThrow({
            where: { id: row.id },
            select: paymentSelect,
          }),
        );
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }
  private async review(
    tx: Prisma.TransactionClient,
    row: Awaited<ReturnType<typeof lockPayment>>,
    reason: ReviewReason,
  ) {
    // A later second capture must not reverse a correctly settled invoice/payment.
    if (row.status === 'SUCCEEDED' || row.status === 'REVIEW') return row;
    const updated = await tx.payment.update({
      where: { id: row.id },
      data: { status: 'REVIEW', reviewReason: reason, verifiedAt: new Date() },
    });
    await this.audit.record(tx, {
      actorId: null,
      entityType: 'PAYMENT',
      entityId: row.id,
      action: 'PAYMENT_STATE_CHANGED',
      metadata: {
        invoiceId: row.invoiceId,
        fromStatus: row.status,
        toStatus: 'REVIEW',
      },
    });
    return updated;
  }
}
