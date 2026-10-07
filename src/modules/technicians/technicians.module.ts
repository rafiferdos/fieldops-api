import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { TechniciansController } from './technicians.controller.js';
import { TechniciansService } from './technicians.service.js';
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TechniciansController],
  providers: [TechniciansService],
})
export class TechniciansModule {}
