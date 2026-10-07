import { z } from 'zod';

const optionalSetting = (schema: z.ZodType) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    schema.optional(),
  );

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FRONTEND_ORIGIN: z.url(),
    REDIS_URL: z.preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? undefined : value,
      z
        .url()
        .refine(
          (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
          'REDIS_URL must use redis:// or rediss://',
        )
        .optional(),
    ),
    GOOGLE_CLIENT_ID: z.preprocess(
      (value) =>
        typeof value === 'string' && !value.trim() ? undefined : value,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/)
        .optional(),
    ),
    SSLCOMMERZ_MODE: optionalSetting(z.enum(['sandbox', 'live'])),
    SSLCOMMERZ_STORE_ID: optionalSetting(z.string().trim().min(1).max(30)),
    SSLCOMMERZ_STORE_PASSWORD: optionalSetting(z.string().min(1).max(100)),
    PUBLIC_API_URL: optionalSetting(
      z
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/' &&
            value.length <= 190
          );
        }, 'PUBLIC_API_URL must be an HTTPS origin without credentials, path, query or fragment')
        .transform((value) => value.replace(/\/$/, '')),
    ),
    JWT_ACCESS_SECRET: z.string().refine((value) => {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length >= 64 && decoded.toString('base64') === value;
    }, 'JWT_ACCESS_SECRET must be a random base64 secret of at least 64 bytes'),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'DATABASE_URL must be a PostgreSQL URL',
      ),
  })
  .superRefine((value, ctx) => {
    const settings = [
      'SSLCOMMERZ_MODE',
      'SSLCOMMERZ_STORE_ID',
      'SSLCOMMERZ_STORE_PASSWORD',
      'PUBLIC_API_URL',
    ] as const;
    const configured = settings.filter((key) => value[key] !== undefined);
    if (configured.length > 0 && configured.length < settings.length) {
      for (const key of settings)
        if (value[key] === undefined)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              'Configure all payment settings together, or leave all blank',
          });
    }
  });

export function validateEnv(input: Record<string, unknown>) {
  return envSchema.parse(input);
}
