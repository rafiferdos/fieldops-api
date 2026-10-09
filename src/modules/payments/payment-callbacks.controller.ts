import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Param,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  browserCallbackKindSchema,
  callbackSchema,
  type BrowserCallbackKind,
  type PaymentCallback,
} from './payment.schema.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { PaymentCallbackGuard } from './payment-callbacks.guard.js';

@Controller('payments/sslcommerz')
@Public()
@UseGuards(PaymentCallbackGuard)
export class PaymentCallbacksController {
  private readonly logger = new Logger(PaymentCallbacksController.name);
  constructor(
    @Inject(PaymentSettlementService)
    private readonly settlements: PaymentSettlementService,
    @Inject(ConfigService) private readonly config: ConfigService,
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

  // Keep server IPN/JSON contracts separate from the browser's POST → GET return.
  @Post('return/:kind')
  @Redirect(undefined, 303)
  @Header('Referrer-Policy', 'no-referrer')
  async browserReturn(
    @Param('kind', new ZodValidationPipe(browserCallbackKindSchema))
    kind: BrowserCallbackKind,
    @Body(new ZodValidationPipe(callbackSchema)) input: PaymentCallback,
  ) {
    const paymentId = await this.settlements.callbackPaymentId(input.tran_id);
    try {
      await this.settlements.callback(input, kind);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500)
        throw error;
      // An unavailable/rolled-back verification never implies a successful charge.
      // The authenticated frontend reads persisted state and offers explicit recovery.
      this.logger.warn(`Payment return requires inspection: ${paymentId}`);
    }
    const url = new URL(
      kind === 'success' ? '/payment/success' : '/payment/cancel',
      this.config.getOrThrow<string>('FRONTEND_ORIGIN'),
    );
    url.searchParams.set('paymentId', paymentId);
    return { url: url.toString(), statusCode: 303 };
  }
}
