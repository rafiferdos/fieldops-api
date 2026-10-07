import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { validateEnv } from './config/env.validation.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module.js';
import { TechniciansModule } from './modules/technicians/technicians.module.js';
import { RequestsModule } from './modules/requests/requests.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
    }),
    HealthModule,
    AuthModule,
    ServicesModule,
    RequestsModule,
    TechniciansModule,
    WorkOrdersModule,
    InvoicesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
