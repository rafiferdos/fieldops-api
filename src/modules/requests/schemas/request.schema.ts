import { z } from 'zod';
import { RequestStatus } from '../../../generated/prisma/enums.js';
import { paginationQueryShape } from '../../../common/http/pagination.js';
import { uuidSchema } from '../../../common/validation/uuid.schema.js';
import { versionSchema } from '../../../common/validation/version.schema.js';

export const requestFields = {
  description: z.string().trim().min(10).max(2000),
  address: z.string().trim().min(10).max(500),
  preferredStart: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine(
      (value) => value instanceof Date && value.getTime() > Date.now(),
      'preferredStart must be in the future',
    ),
};
export const createRequestSchema = z.strictObject({
  serviceId: uuidSchema,
  ...requestFields,
});

const reasonSchema = z.string().trim().min(3).max(500);
export const updateRequestSchema = z
  .strictObject({
    version: versionSchema,
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
    version: versionSchema,
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: reasonSchema.optional(),
  })
  .refine(
    (input) => input.decision !== 'REJECT' || input.reason !== undefined,
    { message: 'A rejection reason is required', path: ['reason'] },
  );
export const cancelRequestSchema = z.strictObject({
  version: versionSchema,
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
