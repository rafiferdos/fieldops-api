import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../../generated/prisma/enums.js';
import { UsersService } from './users.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from './schemas/profile.schema.js';

@Controller('users')
@Roles(Role.CUSTOMER, Role.TECHNICIAN, Role.ADMIN)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentActor() actor: AuthActor) {
    return success(actor.user, 'Profile fetched successfully');
  }

  @Patch('me')
  async updateMe(
    @CurrentActor() actor: AuthActor,
    @Body(new ZodValidationPipe(updateProfileSchema)) input: UpdateProfileInput,
  ) {
    return success(
      await this.users.updateOwnProfile(actor, input),
      'Profile updated successfully',
    );
  }
}
