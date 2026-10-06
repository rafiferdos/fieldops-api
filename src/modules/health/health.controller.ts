import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { success } from '../../common/http/success.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('health')
@Public()
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  live() {
    return success({ status: 'ok' }, 'API is running');
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }

    return success({ database: 'up' }, 'API is ready');
  }
}
