import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { AuditModule } from '../../common/audit/audit.module.js';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
