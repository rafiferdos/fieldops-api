import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ROUTE_ROLES,
  type AllowedRoles,
} from '../decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth.types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AllowedRoles>(ROUTE_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;

    const actor = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().actor;
    if (!actor) throw new UnauthorizedException('Authentication required');
    if (!roles.includes(actor.user.role))
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    return true;
  }
}
