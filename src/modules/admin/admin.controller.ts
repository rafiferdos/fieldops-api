import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import { success } from '../../common/http/success.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentActor } from '../auth/decorators/current-actor.decorator.js';
import type { AuthActor } from '../auth/auth.types.js';
import { AdminService } from './admin.service.js';
import { AdminReportingService } from './admin-reporting.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { uuidSchema } from '../../common/validation/uuid.schema.js';
import { updateAccessSchema, type UpdateAccessInput } from './admin.schema.js';
import { overviewQuerySchema, type OverviewQuery } from './admin.schema.js';
import {
  adminUsersQuerySchema,
  auditQuerySchema,
  type AdminUsersQuery,
  type AuditQuery,
} from './admin.schema.js';

@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AdminReportingService)
    private readonly reporting: AdminReportingService,
    @Inject(AdminAccountsService)
    private readonly accounts: AdminAccountsService,
  ) {}
  @Patch('users/:id')
  async updateAccess(
    @CurrentActor() actor: AuthActor,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateAccessSchema)) input: UpdateAccessInput,
  ) {
    return success(
      await this.accounts.updateAccess(actor, id, input),
      'User access updated successfully',
    );
  }
  @Get('overview')
  async overview(
    @CurrentActor() actor: AuthActor,
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQuery,
  ) {
    return success(
      await this.reporting.overview(actor, query),
      'Overview retrieved successfully',
    );
  }
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
