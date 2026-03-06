import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'test-secret-only';

export function getTestJwtSecret(): string {
  return TEST_JWT_SECRET;
}

export function makeTestToken(
  pharmacyId: number,
  isAdmin = false,
): string {
  return jwt.sign(
    { pharmacyId, isAdmin },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
}

export function makeAuthHeader(
  pharmacyId: number,
  isAdmin = false,
): { Authorization: string } {
  return { Authorization: `Bearer ${makeTestToken(pharmacyId, isAdmin)}` };
}

export interface AuthCookiePharmacy {
  id: number;
  email: string;
  passwordHash: string;
  isAdmin?: boolean | null;
}

export function deriveSessionVersion(passwordHash: string): string {
  return crypto
    .createHmac('sha256', TEST_JWT_SECRET)
    .update(passwordHash)
    .digest('hex')
    .slice(0, 32);
}

export function makeAuthCookie(pharmacy: AuthCookiePharmacy): string {
  const sessionVersion = deriveSessionVersion(pharmacy.passwordHash);
  const token = jwt.sign(
    {
      id: pharmacy.id,
      email: pharmacy.email,
      isAdmin: pharmacy.isAdmin ?? false,
      sessionVersion,
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
  return `token=${token}`;
}

export function makeCsrfPair(): { cookie: string; header: string } {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  return {
    cookie: `csrfToken=${csrfToken}`,
    header: csrfToken,
  };
}
