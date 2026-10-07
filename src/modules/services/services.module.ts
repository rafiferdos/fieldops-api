import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
