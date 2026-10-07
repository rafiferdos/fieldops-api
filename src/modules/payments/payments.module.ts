import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { GatewayHttpService } from '../../infrastructure/sslcommerz/gateway-http.service.js';
import { SslCommerzService } from '../../infrastructure/sslcommerz/sslcommerz.service.js';
import {
  PaymentsController,
  PaymentSessionsController,
} from './payments.controller.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { PaymentCallbacksController } from './payment-callbacks.controller.js';
import { PaymentCallbackGuard } from './payment-callbacks.guard.js';
import { PaymentsService } from './payments.service.js';
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [
    PaymentsController,
    PaymentSessionsController,
    PaymentCallbacksController,
  ],
  providers: [
    GatewayHttpService,
    SslCommerzService,
    PaymentsService,
    PaymentSettlementService,
    PaymentCallbackGuard,
  ],
  exports: [PaymentsService, PaymentSettlementService],
})
export class PaymentsModule {}
