import { z } from 'zod';

export const createServiceSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(2000),
  basePriceMinor: z.number().int().min(0).max(1000000000),
});

export const updateServiceSchema = createServiceSchema
  .partial()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Provide at least one service field',
  );

export type CreateServiceInput = z.output<typeof createServiceSchema>;
export type UpdateServiceInput = z.output<typeof updateServiceSchema>;
