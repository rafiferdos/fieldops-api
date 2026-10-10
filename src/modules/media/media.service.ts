import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CloudinaryService } from '../../infrastructure/media/cloudinary.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireActiveActor } from '../../common/security/active-actor.js';
import type { AuthActor } from '../auth/auth.types.js';
import { validateImageFile, type UploadImageInput } from './image.schema.js';

@Injectable()
export class MediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CloudinaryService) private readonly cloudinary: CloudinaryService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async upload(actor: AuthActor, input: UploadImageInput, value: unknown) {
    const file = validateImageFile(value);
    const roles =
      input.purpose === 'SERVICE'
        ? (['ADMIN'] as const)
        : (['CUSTOMER', 'TECHNICIAN', 'ADMIN'] as const);
    await this.prisma.$transaction((tx) =>
      requireActiveActor(tx, actor, roles),
    );
    const publicId = `fieldops/${input.purpose.toLowerCase()}/${actor.user.id}/${randomUUID()}`;
    // A unique immutable asset is uploaded outside transactions; attachment is a separate authorized save.
    const image = await this.cloudinary.upload(
      file.buffer,
      file.mimetype,
      publicId,
    );
    return this.prisma.$transaction(async (tx) => {
      await requireActiveActor(tx, actor, roles);
      const upload = await tx.mediaUpload.create({
        data: { ownerId: actor.user.id, purpose: input.purpose, ...image },
        select: { id: true, url: true },
      });
      await this.audit.record(tx, {
        actorId: actor.user.id,
        action: 'IMAGE_UPLOADED',
        entityType: 'MEDIA',
        entityId: upload.id,
        metadata: { purpose: input.purpose },
      });
      return upload;
    });
  }
}
