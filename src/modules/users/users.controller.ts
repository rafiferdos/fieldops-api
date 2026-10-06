import { Controller, Get } from '@nestjs/common';
import { success } from '../../common/http/success.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';

@Controller('users')
export class UsersController {
  @Get('me')
  me(@CurrentActor() actor: AuthActor) {
    return success(actor.user, 'Profile fetched successfully');
  }
}
