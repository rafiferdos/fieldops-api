import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth.types.js';
import { SessionsService } from '../sessions.service.js';
import { TokensService } from '../tokens.service.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token =
      typeof authorization === 'string' && authorization.length <= 4096
        ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Authentication required');

    const claims = await this.tokens.verifyAccessToken(token);
    const actor = await this.sessions.findActive(claims.sid, claims.sub);
    if (!actor) throw new UnauthorizedException('Session is unavailable');
    request.actor = actor;
    return true;
  }
}
