import { z } from 'zod';
import { emailSchema, passwordSchema } from './credentials.schema.js';

export const registerSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema.min(15),
});

export type RegisterInput = z.output<typeof registerSchema>;
