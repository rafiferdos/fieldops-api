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
export const requestQuerySchema = z.strictObject({
  ...paginationQueryShape,
  q: z.string().trim().max(100).default(''),
  status: z.enum(RequestStatus).optional(),
  serviceId: uuidSchema.optional(),
  sort: z.enum(['newest', 'oldest', 'preferred_start_asc']).default('newest'),
});
export type CreateRequestInput = z.output<typeof createRequestSchema>;
export type RequestQuery = z.output<typeof requestQuerySchema>;
