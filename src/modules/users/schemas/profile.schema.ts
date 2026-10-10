import { z } from 'zod';
import { imageUrlSchema } from '../../../common/validation/image-url.schema.js';

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
    avatarUrl: imageUrlSchema.nullable().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Provide at least one profile field',
  );

export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
