import 'dotenv/config';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Set TEST_DATABASE_URL in .env before setting up the test database',
  );
}

const testUrl = new URL(process.env.TEST_DATABASE_URL);
const appUrl = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : undefined;
const databaseName = testUrl.pathname.slice(1);
if (
  !['postgres:', 'postgresql:'].includes(testUrl.protocol) ||
  !/^[a-z_][a-z0-9_]*_test$/.test(databaseName) ||
  (appUrl &&
    testUrl.hostname === appUrl.hostname &&
    (testUrl.port || '5432') === (appUrl.port || '5432') &&
    testUrl.pathname === appUrl.pathname)
) {
  throw new Error(
    'TEST_DATABASE_URL must name a separate PostgreSQL database ending in _test',
  );
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({
  connectionString: adminUrl.toString(),
  connectionTimeoutMillis: 5000,
});
try {
  await admin.connect();
  const exists = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [databaseName],
  );
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
} finally {
  await admin.end();
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = fileURLToPath(
  new URL('../node_modules/prisma/build/index.js', import.meta.url),
);
try {
  const result = await promisify(execFile)(
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    },
  );
  process.stdout.write(result.stdout);
  console.log('Test database ready');
} catch (error) {
  console.error(error.stderr || 'Test database migration failed');
  process.exitCode = 1;
}
