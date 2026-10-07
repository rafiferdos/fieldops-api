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
    sessionkey: 'fixture-session',
    GatewayPageURL:
      'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?SESSIONKEY=fixture-session',
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
