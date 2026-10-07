import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { scheduleSchema, type ScheduleInput } from './scheduling.schema.js';
import {
  workOrderQuerySchema,
  progressSchema,
  type WorkOrderQuery,
  type ProgressInput,
} from './scheduling.schema.js';
import { WorkOrdersService } from './work-orders.service.js';
@Controller('work-orders')
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  @Get()
  @Roles('CUSTOMER', 'TECHNICIAN', 'ADMIN')
  async list(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(workOrderQuerySchema)) query: WorkOrderQuery,
  ) {
    return success(
      await this.orders.list(actor, query),
      'Work orders retrieved successfully',
    );
  }
  @Get(':id')
  @Roles('CUSTOMER', 'TECHNICIAN', 'ADMIN')
  async detail(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    return success(
      await this.orders.detail(actor, id),
      'Work order retrieved successfully',
    );
  }
  @Patch(':id/status')
  @Roles('TECHNICIAN')
  async progress(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(progressSchema)) input: ProgressInput,
  ) {
    return success(
      await this.orders.progress(actor, id, input),
      'Work order status updated successfully',
    );
  }
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
