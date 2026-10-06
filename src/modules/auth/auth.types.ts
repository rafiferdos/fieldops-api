import type { PublicUser } from '../users/users.select.js';
import type { Request } from 'express';

export type SessionCredentials = {
  id: string;
  expiresAt: Date;
  user: PublicUser;
  refreshToken: string;
};

export type AuthActor = {
  sessionId: string;
  user: PublicUser;
};

export type AuthenticatedRequest = Request & { actor?: AuthActor };
