import {
  Body,
  Controller,
  Delete,
  Inject,
  Param,
  Patch,
  Post,
  Get,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { success } from '../../common/http/success.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  catalogQuerySchema,
  type CatalogQuery,
} from './schemas/catalog.schema.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { ServicesService } from './services.service.js';
import {
  createServiceSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
} from './schemas/service.schema.js';

@Controller('services')
export class ServicesController {
  constructor(
    @Inject(ServicesService) private readonly services: ServicesService,
  ) {}

  @Get()
  @Public()
  async list(
    @Query(new ZodValidationPipe(catalogQuerySchema)) query: CatalogQuery,
  ) {
    return success(
      await this.services.list(query),
      'Services retrieved successfully',
    );
  }

  @Get(':id')
  @Public()
  async detail(@Param('id', new ZodValidationPipe(uuidSchema)) id: string) {
    return success(
      await this.services.detail(id),
      'Service retrieved successfully',
    );
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @CurrentActor() actor: AuthActor,
    @Body(new ZodValidationPipe(createServiceSchema)) input: CreateServiceInput,
  ) {
    return success(
      await this.services.create(actor, input),
      'Service created successfully',
    );
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) input: UpdateServiceInput,
  ) {
    return success(
      await this.services.update(actor, id, input),
      'Service updated successfully',
    );
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    await this.services.remove(actor, id);
    return success(null, 'Service deleted successfully');
  }
}
