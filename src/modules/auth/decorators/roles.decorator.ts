import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/enums.js';

export const ROUTE_ROLES = Symbol('route-roles');
export type AllowedRoles = readonly [Role, ...Role[]];

export const Roles = (...roles: AllowedRoles) =>
  SetMetadata(ROUTE_ROLES, roles);
