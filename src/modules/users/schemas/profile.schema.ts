import { z } from 'zod';

export const nameSchema = z.string().trim().min(2).max(100);
const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{1,14}$/,
    'Use international format, for example +8801712345678',
  );

export const updateProfileSchema = z
  .strictObject({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
  })
  .refine(
    (input) => input.name !== undefined || input.phone !== undefined,
    'Provide at least one of name or phone',
  );

export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
