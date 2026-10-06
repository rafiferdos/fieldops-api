import { z } from 'zod';
import { emailSchema, passwordSchema } from './credentials.schema.js';
import { nameSchema } from '../../users/schemas/profile.schema.js';

export const registerSchema = z.strictObject({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema.min(15),
});

export type RegisterInput = z.output<typeof registerSchema>;
