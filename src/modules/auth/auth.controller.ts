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
import { Public } from './decorators/public.decorator.js';
import { CurrentActor } from './decorators/current-actor.decorator.js';
import type { AuthActor } from './auth.types.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleRequestGuard } from './guards/google-request.guard.js';
import { googleSchema, type GoogleInput } from './schemas/google.schema.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GoogleAuthService) private readonly google: GoogleAuthService,
  ) {}

  @Post('google')
  @Public()
  @HttpCode(200)
  @UseGuards(GoogleRequestGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleLogin(
    @Body(new ZodValidationPipe(googleSchema)) input: GoogleInput,
  ) {
    return success(
      await this.google.login(input.credential),
      'Signed in successfully',
    );
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
  ) {
    const user = await this.auth.register(input);
    return success(user, 'Account created successfully');
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) {
    return success(await this.auth.login(input), 'Signed in successfully');
  }

  @Post('refresh')
  @Public()
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
  async logout(@CurrentActor() actor: AuthActor) {
    await this.auth.logout(actor.sessionId);
    return success(null, 'Signed out successfully');
  }
}
