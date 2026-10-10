import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(
    [
      '/api/v1/auth',
      '/api/v1/users/me',
      '/api/v1/requests',
      '/api/v1/technicians',
      '/api/v1/work-orders',
      '/api/v1/invoices',
      '/api/v1/payments',
      '/api/v1/admin',
      '/api/v1/media',
    ],
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
  });
  app.setGlobalPrefix('api/v1');
}
