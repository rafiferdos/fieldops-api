import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class GoogleRequestGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.is('application/json'))
      throw new UnsupportedMediaTypeException('Use application/json');
    const origin = request.headers.origin;
    if (origin && origin !== this.config.getOrThrow<string>('FRONTEND_ORIGIN'))
      throw new ForbiddenException('Origin is not allowed');
    return true;
  }
}
