import { Body, Controller, Inject, Param, Patch } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { scheduleSchema, type ScheduleInput } from './scheduling.schema.js';
import { WorkOrdersService } from './work-orders.service.js';
@Controller('work-orders')
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  @Patch(':id/schedule')
  @Roles('ADMIN')
  async schedule(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(scheduleSchema)) input: ScheduleInput,
  ) {
    return success(
      await this.orders.reschedule(actor, id, input),
      'Work order rescheduled successfully',
    );
  }
}
