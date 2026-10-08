import { z } from 'zod';
import { paginationQueryShape } from '../../common/http/pagination.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';

const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));
export const dateRangeShape = {
  from: instant.optional(),
  to: instant.optional(),
};
export function validDateRange(value: { from?: Date; to?: Date }) {
  return (
    (!value.from && !value.to) ||
    (!!value.from &&
      !!value.to &&
      value.to > value.from &&
      value.to.getTime() - value.from.getTime() <= 366 * 86400000)
  );
}
export const dateRangeMessage =
  'Provide both from and to, with an increasing range of at most 366 days';

export const adminUsersQuerySchema = z.strictObject({
  ...paginationQueryShape,
  q: z.string().trim().max(100).default(''),
  role: z.enum(['CUSTOMER', 'TECHNICIAN', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});
export const auditQuerySchema = z
  .strictObject({
    ...paginationQueryShape,
    ...dateRangeShape,
    entityType: z
      .enum(['USER', 'SERVICE', 'REQUEST', 'WORK_ORDER', 'INVOICE', 'PAYMENT'])
      .optional(),
    entityId: uuidSchema.optional(),
    actorId: uuidSchema.optional(),
    action: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z_]{0,79}$/)
      .optional(),
  })
  .refine(validDateRange, dateRangeMessage);
export type AdminUsersQuery = z.output<typeof adminUsersQuerySchema>;
export type AuditQuery = z.output<typeof auditQuerySchema>;
export const overviewQuerySchema = z
  .strictObject(dateRangeShape)
  .refine(validDateRange, dateRangeMessage);
export type OverviewQuery = z.output<typeof overviewQuerySchema>;
