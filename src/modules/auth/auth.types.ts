import type { PublicUser } from '../users/users.select.js';

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
