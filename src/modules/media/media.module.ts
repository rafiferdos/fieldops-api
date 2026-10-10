import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { CloudinaryService } from '../../infrastructure/media/cloudinary.service.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [MediaController],
  providers: [MediaService, CloudinaryService],
})
export class MediaModule {}
