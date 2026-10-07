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

describe('Google startup configuration', () => {
  const validEnv = {
    ...baseEnv,
    JWT_ACCESS_SECRET: randomBytes(64).toString('base64'),
  };

  it.each([undefined, '', '  '])(
    'permits an unconfigured Google client without breaking password login',
    (clientId) => {
      expect(
        validateEnv({ ...validEnv, GOOGLE_CLIENT_ID: clientId })
          .GOOGLE_CLIENT_ID,
      ).toBeUndefined();
    },
  );

  it('accepts a Web OAuth Client ID and rejects a secret/placeholder', () => {
    const clientId = '123456789-test.apps.googleusercontent.com';
    expect(
      validateEnv({ ...validEnv, GOOGLE_CLIENT_ID: clientId }).GOOGLE_CLIENT_ID,
    ).toBe(clientId);
    expect(() =>
      validateEnv({ ...validEnv, GOOGLE_CLIENT_ID: 'your-client-id' }),
    ).toThrow();
  });
});

describe('Optional Redis configuration', () => {
  const valid = {
    ...baseEnv,
    JWT_ACCESS_SECRET: randomBytes(64).toString('base64'),
  };
  it.each([undefined, '', '  '])('permits disabled caching: %s', (url) => {
    expect(validateEnv({ ...valid, REDIS_URL: url }).REDIS_URL).toBeUndefined();
  });
  it.each(['redis://localhost:6379', 'rediss://cache.example.com:6379'])(
    'accepts Redis URLs: %s',
    (url) => {
      expect(validateEnv({ ...valid, REDIS_URL: url }).REDIS_URL).toBe(url);
    },
  );
  it.each(['http://localhost:6379', 'invalid'])(
    'rejects invalid Redis configuration: %s',
    (url) => {
      expect(() => validateEnv({ ...valid, REDIS_URL: url })).toThrow();
    },
  );
});
