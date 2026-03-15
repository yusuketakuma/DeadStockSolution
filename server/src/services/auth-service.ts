import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';
import { getServiceDeps, type ServiceDependencies } from './service-container';

interface AuthServiceDependencies extends ServiceDependencies {
  bcrypt: Pick<typeof bcrypt, 'hash' | 'compare'>;
  crypto: Pick<typeof crypto, 'createHmac'>;
  jwt: Pick<typeof jwt, 'sign' | 'verify'>;
  env: NodeJS.ProcessEnv;
}

const defaultAuthDeps: AuthServiceDependencies = {
  ...getServiceDeps(),
  bcrypt,
  crypto,
  jwt,
  env: process.env,
};

function getAuthDeps(): AuthServiceDependencies {
  return defaultAuthDeps;
}

const SALT_ROUNDS = 10;
const JWT_ALGORITHM = 'HS256';
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

function hasLowEntropy(secret: string): boolean {
  const uniqueChars = new Set(secret).size;
  return uniqueChars < 10;
}

function isWeakJwtSecret(secret: string): boolean {
  if (secret.length < JWT_SECRET_MIN_LENGTH) return true;
  if (WEAK_JWT_SECRET_VALUES.has(secret.toLowerCase())) return true;
  return hasLowEntropy(secret);
}

function getJwtSecret(deps: AuthServiceDependencies = getAuthDeps()): string {
  const secret = deps.env.JWT_SECRET?.trim();
  if (secret) {
    if (deps.env.NODE_ENV !== 'test' && isWeakJwtSecret(secret)) {
      throw new Error(JWT_SECRET_WEAK_ERROR_MESSAGE);
    }
    return secret;
  }

  if (deps.env.NODE_ENV === 'test') {
    return 'test-secret-only';
  }

  throw new Error(JWT_SECRET_MISSING_ERROR_MESSAGE);
}

export function assertJwtSecretConfigured(deps: AuthServiceDependencies = getAuthDeps()): void {
  void getJwtSecret(deps);
}

export function isJwtSecretMissingError(err: unknown): err is Error {
  return err instanceof Error
    && (err.message === JWT_SECRET_MISSING_ERROR_MESSAGE || err.message === JWT_SECRET_WEAK_ERROR_MESSAGE);
}

export async function hashPassword(
  password: string,
  deps: AuthServiceDependencies = getAuthDeps(),
): Promise<string> {
  return deps.bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
  deps: AuthServiceDependencies = getAuthDeps(),
): Promise<boolean> {
  return deps.bcrypt.compare(password, hash);
}

export function deriveSessionVersion(
  passwordHash: string,
  deps: AuthServiceDependencies = getAuthDeps(),
): string {
  return deps.crypto
    .createHmac('sha256', getJwtSecret(deps))
    .update(passwordHash)
    .digest('hex')
    .slice(0, 32);
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.id) || (candidate.id as number) <= 0) return false;
  if (typeof candidate.email !== 'string' || candidate.email.trim().length === 0) return false;
  if (typeof candidate.isAdmin !== 'boolean') return false;
  if (
    candidate.sessionVersion !== undefined
    && (typeof candidate.sessionVersion !== 'string' || candidate.sessionVersion.trim().length === 0)
  ) {
    return false;
  }

  return true;
}

export function generateToken(payload: JwtPayload, deps: AuthServiceDependencies = getAuthDeps()): string {
  return deps.jwt.sign(payload, getJwtSecret(deps), { expiresIn: '24h', algorithm: JWT_ALGORITHM });
}

export function verifyToken(token: string, deps: AuthServiceDependencies = getAuthDeps()): JwtPayload {
  const decoded = deps.jwt.verify(token, getJwtSecret(deps), { algorithms: [JWT_ALGORITHM] });
  if (!isJwtPayload(decoded)) {
    throw new Error('Invalid JWT payload');
  }
  return decoded;
}

export function createAuthService(deps: Partial<AuthServiceDependencies> = {}) {
  const resolvedDeps: AuthServiceDependencies = { ...getAuthDeps(), ...deps };
  return {
    assertJwtSecretConfigured: () => assertJwtSecretConfigured(resolvedDeps),
    hashPassword: (password: string) => hashPassword(password, resolvedDeps),
    verifyPassword: (password: string, hash: string) => verifyPassword(password, hash, resolvedDeps),
    deriveSessionVersion: (passwordHash: string) => deriveSessionVersion(passwordHash, resolvedDeps),
    generateToken: (payload: JwtPayload) => generateToken(payload, resolvedDeps),
    verifyToken: (token: string) => verifyToken(token, resolvedDeps),
  };
}
