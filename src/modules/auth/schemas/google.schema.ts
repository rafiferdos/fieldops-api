import { z } from 'zod';

export const googleSchema = z.strictObject({
  credential: z.string().min(1).max(8192),
});

export type GoogleInput = z.output<typeof googleSchema>;
