import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

const SALT_ROUNDS = 10;
export const JWT_SECRET_MISSING_ERROR_MESSAGE = 'JWT_SECRET environment variable is not set';
export const JWT_SECRET_WEAK_ERROR_MESSAGE = 'JWT_SECRET is too weak';
const JWT_SECRET_MIN_LENGTH = 32;
const WEAK_JWT_SECRET_VALUES = new Set([
  'your-jwt-secret-change-this',
  'test-secret-only',
  'change-this',
  'changeme',
  'secret',
]);

function isWeakJwtSecret(secret: string): boolean {
  if (secret.length < JWT_SECRET_MIN_LENGTH) return true;
  return WEAK_JWT_SECRET_VALUES.has(secret.toLowerCase());
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    if (process.env.NODE_ENV !== 'test' && isWeakJwtSecret(secret)) {
      throw new Error(JWT_SECRET_WEAK_ERROR_MESSAGE);
    }
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
  return err instanceof Error
    && (err.message === JWT_SECRET_MISSING_ERROR_MESSAGE || err.message === JWT_SECRET_WEAK_ERROR_MESSAGE);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function deriveSessionVersion(passwordHash: string): string {
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update(passwordHash)
    .digest('hex')
    .slice(0, 32);
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
