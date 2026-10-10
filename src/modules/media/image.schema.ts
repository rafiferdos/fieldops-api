import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const uploadImageSchema = z.strictObject({
  purpose: z.enum(['AVATAR', 'SERVICE']),
});
export type UploadImageInput = z.output<typeof uploadImageSchema>;

const fileSchema = z.object({
  buffer: z.instanceof(Buffer),
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export function validateImageFile(value: unknown) {
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      'Choose a JPEG, PNG or WebP image up to 3 MB',
    );
  const file = parsed.data;
  const bytes = file.buffer;
  const valid =
    file.size === bytes.length &&
    ((file.mimetype === 'image/jpeg' &&
      bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
      (file.mimetype === 'image/png' &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (file.mimetype === 'image/webp' &&
        bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP'));
  // MIME declarations alone are untrusted; Cloudinary must also successfully decode the bytes.
  if (!valid)
    throw new BadRequestException(
      'The file contents do not match a supported image',
    );
  return file;
}
