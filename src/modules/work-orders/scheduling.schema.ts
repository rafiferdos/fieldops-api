import { z } from 'zod';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { versionSchema } from '../../common/validation/version.schema.js';
import { paginationQueryShape } from '../../common/http/pagination.js';
import { WorkOrderStatus } from '../../generated/prisma/enums.js';

// Explicit offsets; millisecond precision matches JavaScript and timestamptz(3).
const visitDate = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => !/\.\d{4,}/.test(value),
    'Use at most millisecond precision',
  )
  .transform((value) => new Date(value));
const windowSchema = z
  .strictObject({ start: visitDate, end: visitDate })
  .refine(
    ({ start, end }) =>
      start instanceof Date &&
      end instanceof Date &&
      start.getTime() > Date.now() &&
      end > start &&
      end.getTime() - start.getTime() <= 8 * 3600000,
    'Visit must start in the future and last at most 8 hours',
  );
export const assignmentSchema = windowSchema.safeExtend({
  technicianId: uuidSchema,
});
export const scheduleSchema = assignmentSchema.safeExtend({
  version: versionSchema,
});
export const availabilitySchema = windowSchema.safeExtend({
  serviceId: uuidSchema,
  ...paginationQueryShape,
});
export const skillsSchema = z.strictObject({
  serviceIds: z
    .array(uuidSchema)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Duplicate service IDs are not allowed',
    ),
});
export type AssignmentInput = z.output<typeof assignmentSchema>;
export type ScheduleInput = z.output<typeof scheduleSchema>;
export type AvailabilityQuery = z.output<typeof availabilitySchema>;
export type SkillsInput = z.output<typeof skillsSchema>;
export const workOrderQuerySchema = z.strictObject({
  ...paginationQueryShape,
  status: z.enum(WorkOrderStatus).optional(),
  serviceId: uuidSchema.optional(),
  q: z.string().trim().max(100).default(''),
  sort: z.enum(['newest', 'oldest', 'scheduled_start_asc']).default('newest'),
});
export const progressSchema = z.strictObject({
  version: versionSchema,
  status: z.enum(['EN_ROUTE', 'IN_PROGRESS']),
});
export type WorkOrderQuery = z.output<typeof workOrderQuerySchema>;
export type ProgressInput = z.output<typeof progressSchema>;
