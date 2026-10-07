import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { vi } from 'vitest';
import { GatewayHttpService } from '../../src/infrastructure/sslcommerz/gateway-http.service.js';
import { SslCommerzService } from '../../src/infrastructure/sslcommerz/sslcommerz.service.js';
import { runningOrder } from './completion.js';
import { createRequestContext } from './requests.js';

export const billing = {
  billing: { address: 'House 12, Road 3', city: 'Dhaka', postcode: '1000' },
};
export async function createPaymentContext(disabled = false) {
  const http = new GatewayHttpService();
  const json = vi.spyOn(http, 'json');
  const gateway = new SslCommerzService(
    new ConfigService(
      disabled
        ? {}
        : {
            SSLCOMMERZ_MODE: 'sandbox',
            SSLCOMMERZ_STORE_ID: 'fixture-store',
            SSLCOMMERZ_STORE_PASSWORD: 'fixture-password',
            PUBLIC_API_URL: 'https://api.example.com',
          },
    ),
    http,
  );
  const ctx = await createRequestContext((builder) =>
    builder.overrideProvider(SslCommerzService).useValue(gateway),
  );
  await ctx.prisma.user.update({
    where: { id: ctx.owner.id },
    data: {
      phone: '+8801712345678',
      email: `payment-${randomBytes(8).toString('hex')}@example.com`,
    },
  });
  const order = await runningOrder(ctx);
  const response = await request(ctx.app.getHttpServer())
    .post(`/api/v1/work-orders/${order.id}/complete`)
    .set('Authorization', `Bearer ${ctx.technician.token}`)
    .send({
      version: order.version,
      report: 'Completed the inspection and repair.',
    })
    .expect(200);
  const invoiceId = response.body.data.invoice.id as string;
  json.mockResolvedValue({
    status: 'SUCCESS',
    sessionkey: `session-${randomBytes(8).toString('hex')}`,
    GatewayPageURL: `https://sandbox.sslcommerz.com/pay?s=${randomBytes(8).toString('hex')}`,
  });
  return { ...ctx, json, gateway, invoiceId };
}
export type PaymentContext = Awaited<ReturnType<typeof createPaymentContext>>;
export function createCheckout(
  ctx: PaymentContext,
  key: string,
  input: object = billing,
  token = ctx.owner.token,
) {
  return request(ctx.app.getHttpServer())
    .post(`/api/v1/invoices/${ctx.invoiceId}/payment-session`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(input);
}

export type GatewayFixtureCharge = {
  APIConnect: string;
  status: string;
  tran_id: string;
  bank_tran_id: string;
  val_id: string;
  amount: string;
  currency: string;
  currency_type: string;
  currency_amount: string;
  risk_level: string;
};
export function verifiedCharge(
  merchantTranId: string,
  changes: Partial<GatewayFixtureCharge> = {},
): GatewayFixtureCharge {
  return {
    APIConnect: 'DONE',
    status: 'VALID',
    tran_id: merchantTranId,
    bank_tran_id: `bank-${randomBytes(12).toString('hex')}`,
    val_id: `val-${randomBytes(12).toString('hex')}`,
    amount: '1500.00',
    currency: 'BDT',
    currency_type: 'BDT',
    currency_amount: '1500.00',
    risk_level: '0',
    ...changes,
  };
}
export function providerEvidence(
  ctx: PaymentContext,
  charges: GatewayFixtureCharge[],
  terminal = 'PENDING',
) {
  ctx.json.mockImplementation(async (url, form) => {
    if (form)
      return {
        status: 'SUCCESS',
        sessionkey: `session-${randomBytes(8).toString('hex')}`,
        GatewayPageURL:
          'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?SESSIONKEY=fixture-session',
      };
    const validationId = url.searchParams.get('val_id');
    if (validationId)
      return (
        charges.find((c) => c.val_id === validationId) ?? {
          APIConnect: 'DONE',
          status: 'INVALID_TRANSACTION',
        }
      );
    const tranId = url.searchParams.get('tran_id');
    if (tranId) {
      const elements = charges.filter((c) => c.tran_id === tranId);
      return {
        APIConnect: 'DONE',
        no_of_trans_found: elements.length,
        element: elements,
      };
    }
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: {
        sessionKey: url.searchParams.get('sessionkey')!,
        invoiceId: ctx.invoiceId,
      },
    });
    return {
      APIConnect: 'DONE',
      status: terminal,
      sessionkey: payment.sessionKey,
      tran_id: payment.merchantTranId,
      amount: '1500.00',
      currency: 'BDT',
      currency_type: 'BDT',
      currency_amount: '1500.00',
    };
  });
}
export function notify(
  ctx: PaymentContext,
  kind: string,
  merchantTranId: string,
  values: object = {},
) {
  return request(ctx.app.getHttpServer())
    .post(`/api/v1/payments/sslcommerz/${kind}`)
    .type('form')
    .send({ tran_id: merchantTranId, ...values });
}
