import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import type { AuthActor } from '../auth/auth.types.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { feedbackSchema, type FeedbackInput } from './feedback.schema.js';
import { FeedbackService } from './feedback.service.js';

@Controller('work-orders')
export class FeedbackController {
  constructor(
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
  ) {}

  @Post(':id/feedback')
  @Roles('CUSTOMER')
  async submit(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(feedbackSchema)) input: FeedbackInput,
  ) {
    return success(
      await this.feedback.submit(actor, id, input),
      'Feedback submitted successfully',
    );
  }
}
