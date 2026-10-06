import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  hashPassword,
  verifyPassword,
} from '../../common/security/password.js';
import { UserStatus } from '../../generated/prisma/enums.js';
import { UsersService } from '../users/users.service.js';
import type { RegisterInput } from './schemas/register.schema.js';
import type { LoginInput } from './schemas/credentials.schema.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(TokensService) private readonly tokens: TokensService,
  ) {}

  async register(input: RegisterInput) {
    const passwordHash = await hashPassword(input.password);
    return this.users.createCustomer({
      name: input.name,
      email: input.email,
      passwordHash,
    });
  }

  async login(input: LoginInput) {
    const user = await this.users.findForLogin(input.email);
    const validPassword = await verifyPassword(
      input.password,
      user?.passwordHash ?? null,
    );
    if (
      !user?.passwordHash ||
      !validPassword ||
      user.status !== UserStatus.ACTIVE ||
      user.deletedAt
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const session = await this.sessions.create(user.id, user.passwordHash);
    if (!session) throw new UnauthorizedException('Invalid email or password');
    return this.tokens.issue(session);
  }

  async refresh(refreshToken: string) {
    const session = await this.sessions.rotate(refreshToken);
    if (!session)
      throw new UnauthorizedException('Invalid or expired refresh token');
    return this.tokens.issue(session);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
