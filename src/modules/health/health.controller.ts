import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  live() {
    return {
      success: true,
      message: 'API is running',
      data: { status: 'ok' },
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }

    return {
      success: true,
      message: 'API is ready',
      data: { database: 'up' },
    };
  }
}
