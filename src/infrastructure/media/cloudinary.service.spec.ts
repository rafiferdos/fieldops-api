import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudinaryService } from './cloudinary.service.js';

const settings = {
  CLOUDINARY_CLOUD_NAME: 'fieldops-test',
  CLOUDINARY_API_KEY: '123',
  CLOUDINARY_API_SECRET: 'synthetic-test-secret',
};
const publicId = 'fieldops/avatar/11111111-1111-4111-8111-111111111111/image';
const url = `https://res.cloudinary.com/fieldops-test/image/upload/v1/${publicId}.webp`;
const data = {
  public_id: publicId,
  secure_url: url,
  resource_type: 'image',
  type: 'upload',
  format: 'webp',
  version: 1,
  width: 400,
  height: 400,
};
afterEach(() => vi.unstubAllGlobals());

it('fails safely without optional Cloudinary configuration', async () => {
  const service = new CloudinaryService(new ConfigService({}));
  await expect(
    service.upload(Buffer.from('image'), 'image/png', publicId),
  ).rejects.toBeInstanceOf(ServiceUnavailableException);
});
it('uploads local bytes to the fixed authenticated endpoint and verifies the returned asset', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
  vi.stubGlobal('fetch', fetcher);
  const service = new CloudinaryService(new ConfigService(settings));
  expect(
    await service.upload(Buffer.from('image'), 'image/png', publicId),
  ).toEqual({ url, publicId });
  const [endpoint, options] = fetcher.mock.calls[0] ?? [];
  expect(endpoint).toBe(
    'https://api.cloudinary.com/v1_1/fieldops-test/image/upload',
  );
  expect(options?.redirect).toBe('error');
  expect(options?.body).toBeInstanceOf(FormData);
  if (!(options?.body instanceof FormData))
    throw new Error('Expected multipart body');
  expect(options.body.get('public_id')).toBe(publicId);
  expect(options.body.get('overwrite')).toBe('false');
  expect(options.body.get('format')).toBe('webp');
  expect(options.body.get('file')).toBeInstanceOf(Blob);
});
it.each([
  { ...data, public_id: 'another-owner/image' },
  { ...data, secure_url: 'https://evil.example/image.webp' },
  { ...data, secure_url: url.replace('fieldops-test', 'another-cloud') },
  { ...data, width: 100000 },
  { ...data, resource_type: 'raw' },
])('rejects unexpected provider facts', async (response) => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)),
  );
  const service = new CloudinaryService(new ConfigService(settings));
  await expect(
    service.upload(Buffer.from('image'), 'image/png', publicId),
  ).rejects.toBeInstanceOf(BadGatewayException);
});
it('sanitizes provider/network failures without exposing credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(settings.CLOUDINARY_API_SECRET)),
  );
  const service = new CloudinaryService(new ConfigService(settings));
  await expect(
    service.upload(Buffer.from('image'), 'image/png', publicId),
  ).rejects.toThrow(
    'Image upload could not be confirmed. Please try again later',
  );
});
