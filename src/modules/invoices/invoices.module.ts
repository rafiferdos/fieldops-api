import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
