import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

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
  providers: [AuthService, SessionsService, TokensService],
})
export class AuthModule {}
