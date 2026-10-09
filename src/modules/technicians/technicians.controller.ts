import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import {
  availabilitySchema,
  skillsSchema,
  type AvailabilityQuery,
  type SkillsInput,
} from '../work-orders/scheduling.schema.js';
import { TechniciansService } from './technicians.service.js';

@Controller('technicians')
@Roles('ADMIN')
export class TechniciansController {
  constructor(
    @Inject(TechniciansService)
    private readonly technicians: TechniciansService,
  ) {}
  @Get()
  async availability(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(availabilitySchema)) query: AvailabilityQuery,
  ) {
    return success(
      await this.technicians.availability(actor, query),
      'Available technicians retrieved successfully',
    );
  }
  @Get(':id/skills')
  async currentSkills(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ) {
    return success(
      await this.technicians.currentSkills(actor, id),
      'Technician skills retrieved successfully',
    );
  }
  @Put(':id/skills')
  async skills(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(skillsSchema)) input: SkillsInput,
  ) {
    return success(
      await this.technicians.replaceSkills(actor, id, input),
      'Technician skills updated successfully',
    );
  }
}
