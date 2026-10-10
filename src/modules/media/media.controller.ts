import {
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import {
  MAX_IMAGE_BYTES,
  uploadImageSchema,
  type UploadImageInput,
} from './image.schema.js';
import { MediaService } from './media.service.js';

@Controller('media')
@Roles('CUSTOMER', 'TECHNICIAN', 'ADMIN')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('images')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, parts: 2 },
    }),
  )
  async upload(
    @CurrentActor() actor: AuthActor,
    @Body(new ZodValidationPipe(uploadImageSchema)) input: UploadImageInput,
    @UploadedFile() file: unknown,
  ) {
    return success(
      await this.media.upload(actor, input, file),
      'Image uploaded successfully',
    );
  }
}
