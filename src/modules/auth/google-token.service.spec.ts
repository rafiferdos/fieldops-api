import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { GoogleTokenService } from './google-token.service.js';
import {
  googleCredential,
  mockGoogleCertificates,
  GOOGLE_TEST_CLIENT_ID,
} from '../../../test/helpers/google.js';

describe('Google ID token verification', () => {
  let service: GoogleTokenService;
  beforeEach(() => {
    mockGoogleCertificates();
    service = new GoogleTokenService(
      new ConfigService({ GOOGLE_CLIENT_ID: GOOGLE_TEST_CLIENT_ID }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('verifies a signed credential and normalizes safe profile fields', async () => {
    await expect(
      service.verify(
        googleCredential({
          email: ' GOOGLE-TEST@EXAMPLE.COM ',
          name: ' Google Customer ',
        }),
      ),
    ).resolves.toEqual({
      subject: 'google-test-subject',
      email: 'google-test@example.com',
      name: 'Google Customer',
    });
  });

  it.each([
    { aud: 'another-client.apps.googleusercontent.com' },
    { iss: 'https://attacker.example' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { email_verified: false },
    { email_verified: 'true' },
    { email: 'invalid' },
    { sub: '' },
    { sub: 'a'.repeat(256) },
    { exp: undefined },
  ])('rejects invalid verified claims: %j', async (claims) => {
    await expect(
      service.verify(googleCredential(claims)),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired Google credential',
    });
  });

  it('rejects tampered signatures and malformed credentials', async () => {
    const parts = googleCredential().split('.');
    parts[2] = (parts[2]![0] === 'A' ? 'B' : 'A') + parts[2]!.slice(1);
    await expect(service.verify(parts.join('.'))).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.verify('not-a-jwt')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('provides a bounded fallback name when Google supplies no usable name', async () => {
    await expect(
      service.verify(googleCredential({ name: undefined })),
    ).resolves.toMatchObject({ name: 'Google Customer' });
    await expect(
      service.verify(googleCredential({ name: 'a'.repeat(200) })),
    ).resolves.toMatchObject({ name: 'a'.repeat(100) });
  });

  it('fails closed when the configured audience is absent', async () => {
    const config = new ConfigService();
    vi.spyOn(config, 'get').mockReturnValue(undefined);
    const unconfigured = new GoogleTokenService(config);
    await expect(unconfigured.verify(googleCredential())).rejects.toMatchObject(
      { status: 503 },
    );
  });

  it('treats certificate download failures as temporary unavailability', async () => {
    vi.restoreAllMocks();
    const error = new Error('Certificate download failed');
    error.name = 'GaxiosError';
    mockGoogleCertificates().mockRejectedValue(error);
    await expect(service.verify(googleCredential())).rejects.toMatchObject({
      status: 503,
    });
  });
});
