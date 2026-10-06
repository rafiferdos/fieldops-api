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
