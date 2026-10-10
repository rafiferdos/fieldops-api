import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ImagePurpose } from '../../generated/prisma/enums.js';

// A delivery URL alone is not authority; attachment requires our owner/purpose record.
export async function requireOwnedImage(
  tx: Prisma.TransactionClient,
  ownerId: string,
  url: string | null | undefined,
  purpose: ImagePurpose,
) {
  if (url === null || url === undefined) return;
  const upload = await tx.mediaUpload.findFirst({
    where: { ownerId, url, purpose },
    select: { id: true },
  });
  if (!upload)
    throw new BadRequestException(
      'Choose an image you uploaded for this purpose',
    );
}
