import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import type { AuthActor } from '../auth/auth.types.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  idempotencyKeySchema,
  paymentSessionSchema,
  type PaymentSessionInput,
} from './payment.schema.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import { PaymentsService } from './payments.service.js';

@Controller('invoices')
export class PaymentSessionsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}
  @Post(':id/payment-session')
  @Roles('CUSTOMER')
  async create(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @IdempotencyKey(new ZodValidationPipe(idempotencyKeySchema))
    key: string,
    @Body(new ZodValidationPipe(paymentSessionSchema))
    input: PaymentSessionInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.payments.createSession(actor, id, key, input);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return success(
      result.payment,
      result.created ? 'Payment attempt created' : 'Payment attempt retrieved',
    );
  }
}
@Controller('payments')
@Roles('CUSTOMER', 'ADMIN')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}
  @Get(':id')
  async detail(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    return success(
      await this.payments.detail(actor, id),
      'Payment retrieved successfully',
    );
  }
}
