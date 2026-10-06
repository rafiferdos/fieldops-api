import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { vi } from 'vitest';

export const GOOGLE_TEST_CLIENT_ID =
  '123456789-test.apps.googleusercontent.com';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
type CertificateResponse = Awaited<
  ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>
>;

// Only Google's certificate download is mocked; real signature/claim verification runs.
export function mockGoogleCertificates() {
  return vi
    .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
    .mockResolvedValue({
      certs: {
        test: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      format: 'PEM' as CertificateResponse['format'],
    });
}

export function googleCredential(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: GOOGLE_TEST_CLIENT_ID,
      iat: now,
      exp: now + 3600,
      sub: 'google-test-subject',
      email: 'google-test@example.com',
      email_verified: true,
      name: 'Google Customer',
      ...overrides,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}
