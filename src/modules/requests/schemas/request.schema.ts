import { z } from 'zod';
import { RequestStatus } from '../../../generated/prisma/enums.js';
import { paginationQueryShape } from '../../../common/http/pagination.js';
import { uuidSchema } from '../../../common/validation/uuid.schema.js';

export const requestFields = {
  description: z.string().trim().min(10).max(2000),
  address: z.string().trim().min(10).max(500),
  preferredStart: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine(
      (value) => value.getTime() > Date.now(),
      'preferredStart must be in the future',
    ),
};
export const createRequestSchema = z.strictObject({
  serviceId: uuidSchema,
  ...requestFields,
});
export const requestVersionSchema = z.number().int().min(1).max(2147483646);
const reasonSchema = z.string().trim().min(3).max(500);
export const updateRequestSchema = z
  .strictObject({
    version: requestVersionSchema,
    description: requestFields.description.optional(),
    address: requestFields.address.optional(),
    preferredStart: requestFields.preferredStart.optional(),
  })
  .refine(
    (input) =>
      input.description !== undefined ||
      input.address !== undefined ||
      input.preferredStart !== undefined,
    'Provide at least one request field',
  );
export const reviewRequestSchema = z
  .strictObject({
    version: requestVersionSchema,
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: reasonSchema.optional(),
  })
  .refine(
    (input) => input.decision !== 'REJECT' || input.reason !== undefined,
    { message: 'A rejection reason is required', path: ['reason'] },
  );
export const cancelRequestSchema = z.strictObject({
  version: requestVersionSchema,
  reason: reasonSchema,
});
export const requestQuerySchema = z.strictObject({
  ...paginationQueryShape,
  q: z.string().trim().max(100).default(''),
  status: z.enum(RequestStatus).optional(),
  serviceId: uuidSchema.optional(),
  sort: z.enum(['newest', 'oldest', 'preferred_start_asc']).default('newest'),
});
export type CreateRequestInput = z.output<typeof createRequestSchema>;
export type RequestQuery = z.output<typeof requestQuerySchema>;
export type UpdateRequestInput = z.output<typeof updateRequestSchema>;
export type ReviewRequestInput = z.output<typeof reviewRequestSchema>;
export type CancelRequestInput = z.output<typeof cancelRequestSchema>;
