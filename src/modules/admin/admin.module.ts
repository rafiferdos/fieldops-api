import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminReportingService } from './admin-reporting.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AuditModule } from '../../common/audit/audit.module.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminReportingService, AdminAccountsService],
})
export class AdminModule {}
