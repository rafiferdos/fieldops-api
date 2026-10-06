import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_ORIGIN: z.url(),
  JWT_ACCESS_SECRET: z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length >= 64 && decoded.toString('base64') === value;
  }, 'JWT_ACCESS_SECRET must be a random base64 secret of at least 64 bytes'),
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      'DATABASE_URL must be a PostgreSQL URL',
    ),
});

export function validateEnv(input: Record<string, unknown>) {
  return envSchema.parse(input);
}
