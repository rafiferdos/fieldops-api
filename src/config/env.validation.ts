import { z } from 'zod';

const optionalSetting = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    schema.optional(),
  );

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return (
    (url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === '/'
  );
}, 'Use an HTTPS origin (or loopback HTTP) without credentials, path, query or fragment');

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FRONTEND_ORIGIN: originSchema.transform((value) =>
      value.replace(/\/$/, ''),
    ),
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
    CLOUDINARY_CLOUD_NAME: optionalSetting(
      z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    ),
    CLOUDINARY_API_KEY: optionalSetting(z.string().regex(/^\d{1,100}$/)),
    CLOUDINARY_API_SECRET: optionalSetting(z.string().min(1).max(200)),
    SSLCOMMERZ_STORE_ID: optionalSetting(z.string().trim().min(1).max(30)),
    SSLCOMMERZ_STORE_PASSWORD: optionalSetting(z.string().min(1).max(100)),
    PUBLIC_API_URL: optionalSetting(
      originSchema
        .refine((value) => value.length <= 190)
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
    const mediaSettings = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ] as const;
    const mediaConfigured = mediaSettings.filter(
      (key) => value[key] !== undefined,
    );
    if (
      mediaConfigured.length > 0 &&
      mediaConfigured.length < mediaSettings.length
    )
      for (const key of mediaSettings)
        if (value[key] === undefined)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              'Configure all Cloudinary settings together, or leave all blank',
          });
    // Loopback HTTP is exclusively a local sandbox browser-return test facility.
    // Live callbacks and production frontend returns always require HTTPS.
    for (const key of ['PUBLIC_API_URL', 'FRONTEND_ORIGIN'] as const) {
      const url = value[key];
      if (
        url?.startsWith('http:') &&
        (value.NODE_ENV === 'production' ||
          (key === 'PUBLIC_API_URL' && value.SSLCOMMERZ_MODE !== 'sandbox'))
      )
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Production/live payment returns require HTTPS',
        });
    }
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
