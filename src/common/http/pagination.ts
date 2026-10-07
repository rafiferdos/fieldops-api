import { z } from 'zod';

export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export function pagination(
  total: number,
  query: { page: number; limit: number },
) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}
