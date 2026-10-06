import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const passwordSchema = z.string().min(1).max(128);

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.output<typeof loginSchema>;
