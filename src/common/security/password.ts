import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  const hashToVerify =
    storedHash ??
    (await (dummyHash ??= hashPassword(randomBytes(32).toString('base64url'))));
  return verify(hashToVerify, password);
}
