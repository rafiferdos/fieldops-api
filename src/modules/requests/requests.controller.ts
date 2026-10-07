import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
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
}
