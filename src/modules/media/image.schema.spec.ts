import { BadRequestException } from '@nestjs/common';
import { validateImageFile, MAX_IMAGE_BYTES } from './image.schema.js';
import { imageUrlSchema } from '../../common/validation/image-url.schema.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
  'base64',
);
const file = { buffer: png, size: png.length, mimetype: 'image/png' };

it('accepts bounded PNG bytes without trusting an original filename', () => {
  expect(
    validateImageFile({ ...file, originalname: '../../avatar.png' }),
  ).toEqual(file);
});
it.each([
  'not-a-url',
  undefined,
  { ...file, mimetype: 'image/svg+xml' },
  { ...file, mimetype: 'image/jpeg' },
  { ...file, buffer: Buffer.from('<script>malicious</script>') },
  { ...file, size: MAX_IMAGE_BYTES + 1 },
  { ...file, size: png.length + 1 },
])('rejects unsupported, spoofed and oversized files', (input) => {
  expect(() => validateImageFile(input)).toThrow(BadRequestException);
});
it.each([
  'http://res.cloudinary.com/demo/image/upload/v1/fieldops/a.webp',
  'https://evil.example/image.webp',
  'https://res.cloudinary.com@evil.example/demo/image/upload/v1/fieldops/a.webp',
  'https://res.cloudinary.com/demo/image/upload/v1/fieldops/a.webp?redirect=x',
  'https://res.cloudinary.com/demo/raw/upload/v1/fieldops/a.svg',
])('rejects delivery URLs outside the trusted image boundary', (url) => {
  expect(imageUrlSchema.safeParse(url).success).toBe(false);
});
