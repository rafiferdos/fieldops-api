import { z } from 'zod';

export const refreshSchema = z.strictObject({
  refreshToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid refresh token format'),
});

export type RefreshInput = z.output<typeof refreshSchema>;
