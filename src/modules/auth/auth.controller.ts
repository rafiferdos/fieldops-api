import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import {
  registerSchema,
  type RegisterInput,
} from './schemas/register.schema.js';
import { loginSchema, type LoginInput } from './schemas/credentials.schema.js';
import { refreshSchema, type RefreshInput } from './schemas/refresh.schema.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { CurrentActor } from './decorators/current-actor.decorator.js';
import type { AuthActor } from './auth.types.js';

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

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) {
    return success(await this.auth.login(input), 'Signed in successfully');
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) input: RefreshInput,
  ) {
    return success(
      await this.auth.refresh(input.refreshToken),
      'Session refreshed successfully',
    );
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  async logout(@CurrentActor() actor: AuthActor) {
    await this.auth.logout(actor.sessionId);
    return success(null, 'Signed out successfully');
  }
}
