import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  AuthProvider,
  Role,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { publicUserSelect } from '../users/users.select.js';
import { GoogleTokenService } from './google-token.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

@Injectable()
export class GoogleAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleTokenService) private readonly google: GoogleTokenService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(TokensService) private readonly tokens: TokensService,
  ) {}

  async login(credential: string) {
    // Network verification stays outside the database transaction.
    const profile = await this.google.verify(credential);
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        // Serialize first sign-ins for the same subject across API processes.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`google:${profile.subject}`}, 0))`;
        const identity = await tx.authIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: AuthProvider.GOOGLE,
              providerSubject: profile.subject,
            },
          },
          select: {
            user: {
              select: { ...publicUserSelect, status: true, deletedAt: true },
            },
          },
        });

        if (identity) {
          const { status, deletedAt, ...user } = identity.user;
          if (status !== UserStatus.ACTIVE || deletedAt)
            throw new UnauthorizedException('Account is unavailable');
          // Subject owns the identity; changed Google email must not rebind it.
          return this.sessions.createInTransaction(tx, user);
        }

        const user = await tx.user.create({
          data: {
            name: profile.name,
            email: profile.email,
            role: Role.CUSTOMER,
            identities: {
              create: {
                provider: AuthProvider.GOOGLE,
                providerSubject: profile.subject,
              },
            },
          },
          select: publicUserSelect,
        });
        return this.sessions.createInTransaction(tx, user);
      });
      return this.tokens.issue(session);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Email is already registered; sign in using your existing method',
        );
      throw error;
    }
  }
}
