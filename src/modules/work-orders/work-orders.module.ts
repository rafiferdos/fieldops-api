import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { AssignmentsController } from './assignments.controller.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { WorkOrdersService } from './work-orders.service.js';
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AssignmentsController, WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
