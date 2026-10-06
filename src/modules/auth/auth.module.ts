import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleTokenService } from './google-token.service.js';
import { GoogleRequestGuard } from './guards/google-request.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

@Module({
  imports: [
    UsersModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          issuer: 'fieldops-api',
          audience: 'fieldops-client',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'fieldops-api',
          audience: 'fieldops-client',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    TokensService,
    AccessTokenGuard,
    GoogleAuthService,
    GoogleTokenService,
    GoogleRequestGuard,
    { provide: APP_GUARD, useExisting: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
