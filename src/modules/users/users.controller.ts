import { Controller, Get } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../../generated/prisma/enums.js';

@Controller('users')
@Roles(Role.CUSTOMER, Role.TECHNICIAN, Role.ADMIN)
export class UsersController {
  @Get('me')
  me(@CurrentActor() actor: AuthActor) {
    return success(actor.user, 'Profile fetched successfully');
  }
}
