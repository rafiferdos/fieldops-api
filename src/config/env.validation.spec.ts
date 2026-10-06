import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.validation.js';

const baseEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  FRONTEND_ORIGIN: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://test:example@localhost:5432/fieldops_test',
};

describe('JWT startup configuration', () => {
  it('accepts a generated 64-byte base64 secret and parses the port', () => {
    const secret = randomBytes(64).toString('base64');
    expect(
      validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: secret }),
    ).toMatchObject({ PORT: 3000, JWT_ACCESS_SECRET: secret });
  });

  it.each([
    undefined,
    'replace_with_a_random_64_byte_base64_secret',
    randomBytes(32).toString('base64'),
    '!'.repeat(88),
  ])('rejects absent, placeholder, short or malformed secrets', (secret) => {
    expect(() =>
      validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: secret }),
    ).toThrow();
  });
});
