import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { callbackSchema, type PaymentCallback } from './payment.schema.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { PaymentCallbackGuard } from './payment-callbacks.guard.js';

@Controller('payments/sslcommerz')
@Public()
@UseGuards(PaymentCallbackGuard)
export class PaymentCallbacksController {
  constructor(
    @Inject(PaymentSettlementService)
    private readonly settlements: PaymentSettlementService,
  ) {}
  private async receive(
    input: PaymentCallback,
    kind: 'ipn' | 'success' | 'fail' | 'cancel',
  ) {
    await this.settlements.callback(input, kind);
    return success(
      { received: true },
      'Payment notification verified and processed',
    );
  }
  @Post('ipn')
  @HttpCode(200)
  ipn(@Body(new ZodValidationPipe(callbackSchema)) input: PaymentCallback) {
    return this.receive(input, 'ipn');
  }
  @Post('success')
  @HttpCode(200)
  succeeded(
    @Body(new ZodValidationPipe(callbackSchema)) input: PaymentCallback,
  ) {
    return this.receive(input, 'success');
  }
  @Post('fail')
  @HttpCode(200)
  failed(@Body(new ZodValidationPipe(callbackSchema)) input: PaymentCallback) {
    return this.receive(input, 'fail');
  }
  @Post('cancel')
  @HttpCode(200)
  cancelled(
    @Body(new ZodValidationPipe(callbackSchema)) input: PaymentCallback,
  ) {
    return this.receive(input, 'cancel');
  }
}
