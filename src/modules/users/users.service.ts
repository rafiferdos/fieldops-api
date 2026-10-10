import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { Role, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ownProfileSelect, publicUserSelect } from './users.select.js';
import type { AuthActor } from '../auth/auth.types.js';
import type { UpdateProfileInput } from './schemas/profile.schema.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { requireOwnedImage } from '../../common/security/owned-image.js';

type CreateCustomerInput = {
  name: string;
  email: string;
  passwordHash: string;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  findForLogin(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, status: true, deletedAt: true },
    });
  }

  async updateOwnProfile(actor: AuthActor, input: UpdateProfileInput) {
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        await requireOwnedImage(tx, actor.user.id, input.avatarUrl, 'AVATAR');
        // Recheck eligibility at the write boundary; never take an owner from input.
        const user = await tx.user.update({
          where: {
            id: actor.user.id,
            status: UserStatus.ACTIVE,
            deletedAt: null,
            sessions: {
              some: {
                id: actor.sessionId,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            },
          },
          data,
          select: ownProfileSelect,
        });
        await this.audit.record(tx, {
          actorId: user.id,
          action: 'USER_PROFILE_UPDATED',
          entityType: 'USER',
          entityId: user.id,
          // Field names only: no credentials or personal values in audit metadata.
          metadata: {
            updatedFields: Object.keys(data).filter(
              (field): field is 'name' | 'phone' | 'avatarUrl' =>
                field === 'name' || field === 'phone' || field === 'avatarUrl',
            ),
          },
        });
        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new UnauthorizedException('Account or session is unavailable');
      throw error;
    }
  }

  async createCustomer(input: CreateCustomerInput) {
    try {
      return await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          role: Role.CUSTOMER,
        },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Email is the only caller-supplied unique field in this operation.
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }
}
