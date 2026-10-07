import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { RequestsService } from './requests.service.js';
import {
  createRequestSchema,
  requestQuerySchema,
  type CreateRequestInput,
  type RequestQuery,
  updateRequestSchema,
  reviewRequestSchema,
  cancelRequestSchema,
  type UpdateRequestInput,
  type ReviewRequestInput,
  type CancelRequestInput,
} from './schemas/request.schema.js';

@Controller('requests')
export class RequestsController {
  constructor(
    @Inject(RequestsService) private readonly requests: RequestsService,
  ) {}

  @Post()
  @Roles(Role.CUSTOMER)
  async create(
    @CurrentActor() actor: AuthActor,
    @Body(new ZodValidationPipe(createRequestSchema)) input: CreateRequestInput,
  ) {
    return success(
      await this.requests.create(actor, input),
      'Request created successfully',
    );
  }

  @Get()
  @Roles(Role.CUSTOMER, Role.ADMIN)
  async list(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(requestQuerySchema)) query: RequestQuery,
  ) {
    return success(
      await this.requests.list(actor, query),
      'Requests retrieved successfully',
    );
  }

  @Get(':id')
  @Roles(Role.CUSTOMER, Role.ADMIN)
  async detail(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    return success(
      await this.requests.detail(actor, id),
      'Request retrieved successfully',
    );
  }

  @Patch(':id')
  @Roles(Role.CUSTOMER)
  async update(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateRequestSchema)) input: UpdateRequestInput,
  ) {
    return success(
      await this.requests.update(actor, id, input),
      'Request updated successfully',
    );
  }

  @Patch(':id/review')
  @Roles(Role.ADMIN)
  async review(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(reviewRequestSchema)) input: ReviewRequestInput,
  ) {
    return success(
      await this.requests.review(actor, id, input),
      'Request reviewed successfully',
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  async cancel(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(cancelRequestSchema)) input: CancelRequestInput,
  ) {
    return success(
      await this.requests.cancel(actor, id, input),
      'Request cancelled successfully',
    );
  }
}
