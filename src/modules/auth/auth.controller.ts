import { Body, Controller, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import {
  registerSchema,
  type RegisterInput,
} from './schemas/register.schema.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
  ) {
    const user = await this.auth.register(input);
    return success(user, 'Account created successfully');
  }
}
