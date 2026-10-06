import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthActor, AuthenticatedRequest } from '../auth.types.js';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthActor => {
    const actor = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().actor;
    if (!actor) throw new UnauthorizedException('Authentication required');
    return actor;
  },
);
