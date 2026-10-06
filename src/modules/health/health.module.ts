import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
