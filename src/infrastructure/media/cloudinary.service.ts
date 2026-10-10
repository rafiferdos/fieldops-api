import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { imageUrlSchema } from '../../common/validation/image-url.schema.js';

const uploadResponseSchema = z.object({
  public_id: z.string(),
  secure_url: imageUrlSchema,
  resource_type: z.literal('image'),
  type: z.literal('upload'),
  format: z.literal('webp'),
  version: z.number().int().positive(),
  width: z.number().int().positive().max(1600),
  height: z.number().int().positive().max(1600),
});

@Injectable()
export class CloudinaryService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async upload(buffer: Buffer, mime: string, publicId: string) {
    const cloud = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const key = this.config.get<string>('CLOUDINARY_API_KEY');
    const secret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloud || !key || !secret)
      throw new ServiceUnavailableException('Image upload is not configured');
    const body = new FormData();
    body.set(
      'file',
      new Blob([Uint8Array.from(buffer)], { type: mime }),
      'image',
    );
    body.set('public_id', publicId);
    body.set('overwrite', 'false');
    body.set('format', 'webp');
    body.set('transformation', 'c_limit,w_1600,h_1600');
    try {
      // Only bounded local bytes reach a fixed provider endpoint; never fetch a caller URL.
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
          },
          body,
          signal: AbortSignal.timeout(20_000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('Provider upload failed');
      const image = uploadResponseSchema.parse(await response.json());
      const expectedUrl = `https://res.cloudinary.com/${cloud}/image/upload/v${image.version}/${publicId}.webp`;
      if (image.public_id !== publicId || image.secure_url !== expectedUrl)
        throw new Error('Provider returned an unexpected asset');
      return { url: image.secure_url, publicId: image.public_id };
    } catch {
      // Provider responses and credential-bearing request details never reach the client or logs.
      throw new BadGatewayException(
        'Image upload could not be confirmed. Please try again later',
      );
    }
  }
}
