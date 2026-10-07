import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
