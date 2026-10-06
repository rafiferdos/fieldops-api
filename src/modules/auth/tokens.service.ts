import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import type { SessionCredentials } from './auth.types.js';

const accessClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  tokenUse: z.literal('access'),
  iat: z.number().int(),
  exp: z.number().int(),
});

@Injectable()
export class TokensService {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async issue(session: SessionCredentials) {
    const expiresIn = Math.min(
      15 * 60,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    if (expiresIn < 1) throw new UnauthorizedException('Session has expired');

    const accessToken = await this.jwt.signAsync(
      { sub: session.user.id, sid: session.id, tokenUse: 'access' },
      { expiresIn, jwtid: randomUUID() },
    );
    return {
      user: session.user,
      accessToken,
      refreshToken: session.refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn,
      refreshExpiresAt: session.expiresAt,
    };
  }

  async verifyAccessToken(token: string) {
    try {
      const payload =
        await this.jwt.verifyAsync<Record<string, unknown>>(token);
      return accessClaimsSchema.parse(payload);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
