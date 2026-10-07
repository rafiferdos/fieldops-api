import { Controller, Get, Inject, Param } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { InvoicesService } from './invoices.service.js';

@Controller('invoices')
@Roles('CUSTOMER', 'ADMIN')
export class InvoicesController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}
  @Get(':id')
  async detail(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    return success(
      await this.invoices.detail(actor, id),
      'Invoice retrieved successfully',
    );
  }
}
