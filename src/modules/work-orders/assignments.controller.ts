import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { assignmentSchema, type AssignmentInput } from './scheduling.schema.js';
import { WorkOrdersService } from './work-orders.service.js';
@Controller('requests')
export class AssignmentsController {
  constructor(
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
  ) {}
  @Post(':id/assignment')
  @Roles('ADMIN')
  async assign(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(assignmentSchema)) input: AssignmentInput,
  ) {
    return success(
      await this.orders.assign(actor, id, input),
      'Work order assigned successfully',
    );
  }
}
