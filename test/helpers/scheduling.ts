import request from 'supertest';
import { createOwnedRequest, type RequestContext } from './requests.js';
import type { workOrderView } from '../../src/modules/work-orders/work-order.select.js';

export function visitWindow(offsetHours = 24) {
  const start = new Date(Date.now() + offsetHours * 3600000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 3600000).toISOString(),
  };
}
export async function grantSkill(ctx: RequestContext) {
  await request(ctx.app.getHttpServer())
    .put(`/api/v1/technicians/${ctx.technician.id}/skills`)
    .set('Authorization', `Bearer ${ctx.admin.token}`)
    .send({ serviceIds: [ctx.service.id] })
    .expect(200);
}
export async function approvedRequest(ctx: RequestContext) {
  const req = await createOwnedRequest(ctx);
  const response = await request(ctx.app.getHttpServer())
    .patch(`/api/v1/requests/${req.id}/review`)
    .set('Authorization', `Bearer ${ctx.admin.token}`)
    .send({ version: req.version, decision: 'APPROVE' })
    .expect(200);
  return { id: req.id, version: response.body.data.version as number };
}
export function assignRequest(
  ctx: RequestContext,
  requestId: string,
  overrides: object = {},
  token = ctx.admin.token,
) {
  return request(ctx.app.getHttpServer())
    .post(`/api/v1/requests/${requestId}/assignment`)
    .set('Authorization', `Bearer ${token}`)
    .send({ technicianId: ctx.technician.id, ...visitWindow(), ...overrides });
}
export async function assignedOrder(
  ctx: RequestContext,
  dates = visitWindow(),
) {
  await grantSkill(ctx);
  const req = await approvedRequest(ctx);
  const response = await assignRequest(ctx, req.id, dates).expect(201);
  return response.body.data as ReturnType<typeof workOrderView>;
}
