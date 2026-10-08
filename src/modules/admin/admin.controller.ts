import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { AdminService } from './admin.service.js';
import {
  adminUsersQuerySchema,
  auditQuerySchema,
  type AdminUsersQuery,
  type AuditQuery,
} from './admin.schema.js';

@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('users')
  async users(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(adminUsersQuerySchema)) query: AdminUsersQuery,
  ) {
    return success(
      await this.admin.users(actor, query),
      'Users retrieved successfully',
    );
  }
  @Get('audit-logs')
  async auditLogs(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    return success(
      await this.admin.auditLogs(actor, query),
      'Audit logs retrieved successfully',
    );
  }
}
