import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
