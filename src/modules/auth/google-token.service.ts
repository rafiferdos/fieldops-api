import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { emailSchema } from './schemas/credentials.schema.js';

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: emailSchema,
  email_verified: z.literal(true),
  exp: z.number().int(),
  name: z.string().optional(),
});

export type GoogleProfile = { subject: string; email: string; name: string };

@Injectable()
export class GoogleTokenService {
  private readonly client = new OAuth2Client({
    transporterOptions: { timeout: 5000 },
  });

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async verify(credential: string): Promise<GoogleProfile> {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience)
      throw new ServiceUnavailableException('Google login is not configured');

    try {
      // Signature, audience, issuer and expiry are verified by Google's library.
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      const claims = claimsSchema.parse(ticket.getPayload());
      // Do not accept already-expired tokens during the library's clock-skew window.
      if (claims.exp <= Date.now() / 1000) throw new Error('Expired token');
      const name = claims.name?.trim().slice(0, 100);
      return {
        subject: claims.sub,
        email: claims.email,
        name: name && name.length >= 2 ? name : 'Google Customer',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'GaxiosError')
        throw new ServiceUnavailableException(
          'Google authentication is unavailable',
        );
      throw new UnauthorizedException('Invalid or expired Google credential');
    }
  }
}
