import 'dotenv/config';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'Set TEST_DATABASE_URL to a separate migrated PostgreSQL database ending in _test',
  );
}

const testDatabase = new URL(testUrl);
const appDatabase = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : undefined;
if (
  !['postgres:', 'postgresql:'].includes(testDatabase.protocol) ||
  !testDatabase.pathname.endsWith('_test') ||
  (appDatabase &&
    testDatabase.hostname === appDatabase.hostname &&
    (testDatabase.port || '5432') === (appDatabase.port || '5432') &&
    testDatabase.pathname === appDatabase.pathname)
) {
  throw new Error(
    'E2E tests require a separate PostgreSQL database ending in _test',
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
const testRedisUrl = process.env.TEST_REDIS_URL;
if (testRedisUrl) {
  const redis = new URL(testRedisUrl);
  if (
    !['redis:', 'rediss:'].includes(redis.protocol) ||
    !/^\/[1-9]\d*$/.test(redis.pathname)
  ) {
    throw new Error(
      'TEST_REDIS_URL must use a separate Redis database index greater than zero',
    );
  }
}
process.env.REDIS_URL = testRedisUrl ?? '';

// Tests never inherit live provider configuration. Google fixtures supply test
// audiences/keys; payment fixtures replace only the gateway HTTP transport.
for (const key of [
  'GOOGLE_CLIENT_ID',
  'SSLCOMMERZ_MODE',
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWORD',
  'PUBLIC_API_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
])
  process.env[key] = '';
