import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

const SALT_ROUNDS = 10;
export const JWT_SECRET_MISSING_ERROR_MESSAGE = 'JWT_SECRET environment variable is not set';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'test') {
    return 'test-secret-only';
  }

  throw new Error(JWT_SECRET_MISSING_ERROR_MESSAGE);
}

export function assertJwtSecretConfigured(): void {
  void getJwtSecret();
}

export function isJwtSecretMissingError(err: unknown): err is Error {
  return err instanceof Error && err.message === JWT_SECRET_MISSING_ERROR_MESSAGE;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
