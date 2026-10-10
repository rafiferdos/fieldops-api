import { z } from 'zod';
import { createServiceSchema } from './service.schema.js';
import { paginationQueryShape } from '../../../common/http/pagination.js';

export const catalogQuerySchema = z.strictObject({
  q: z.string().trim().max(100).default(''),
  ...paginationQueryShape,
  sort: z
    .enum(['newest', 'oldest', 'name_asc', 'price_asc', 'price_desc'])
    .default('newest'),
});

export const publicServiceSchema = createServiceSchema.extend({
  imageUrl: createServiceSchema.shape.imageUrl.unwrap(),
  id: z.uuid(),
  currency: z.literal('BDT'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const catalogPageSchema = z.strictObject({
  items: z.array(publicServiceSchema).max(100),
  pagination: z.strictObject({
    page: z.number().int().min(1).max(100000),
    limit: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
export type CatalogQuery = z.output<typeof catalogQuerySchema>;
