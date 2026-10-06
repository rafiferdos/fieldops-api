import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController readiness', () => {
  it('reports unavailability when the database query fails', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: vi.fn().mockRejectedValue(new Error('Database offline')),
          },
        },
      ],
    }).compile();

    await expect(module.get(HealthController).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await module.close();
  });
});
