import request from 'supertest';
import type { RequestContext } from './requests.js';
import { assignedOrder } from './scheduling.js';

export async function runningOrder(ctx: RequestContext) {
  const order = await assignedOrder(ctx);
  await request(ctx.app.getHttpServer())
    .patch(`/api/v1/work-orders/${order.id}/status`)
    .set('Authorization', `Bearer ${ctx.technician.token}`)
    .send({ version: 1, status: 'EN_ROUTE' })
    .expect(200);
  const result = await request(ctx.app.getHttpServer())
    .patch(`/api/v1/work-orders/${order.id}/status`)
    .set('Authorization', `Bearer ${ctx.technician.token}`)
    .send({ version: 2, status: 'IN_PROGRESS' })
    .expect(200);
  return {
    ...order,
    status: 'IN_PROGRESS' as const,
    version: result.body.data.version as number,
  };
}
