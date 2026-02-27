import { afterEach, describe, it, expect } from 'vitest';
import { deriveSessionVersion, hashPassword, verifyPassword, generateToken, verifyToken } from '../services/auth-service';

describe('auth-service', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies a password', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correctPassword1');
      expect(await verifyPassword('wrongPassword2', hash)).toBe(false);
    });

    it('produces different hashes for same password', async () => {
      const hash1 = await hashPassword('SamePass123');
      const hash2 = await hashPassword('SamePass123');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateToken / verifyToken', () => {
    it('generates and verifies a JWT token', () => {
      const payload = { id: 1, email: 'test@example.com', isAdmin: false };
      const token = generateToken(payload);
      expect(typeof token).toBe('string');

      const decoded = verifyToken(token);
      expect(decoded.id).toBe(1);
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.isAdmin).toBe(false);
    });

    it('includes admin flag', () => {
      const payload = { id: 2, email: 'admin@example.com', isAdmin: true };
      const token = generateToken(payload);
      const decoded = verifyToken(token);
      expect(decoded.isAdmin).toBe(true);
    });

    it('throws for invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow();
    });

    it('throws for tampered token', () => {
      const token = generateToken({ id: 1, email: 'test@example.com', isAdmin: false });
      const tampered = token + 'x';
      expect(() => verifyToken(tampered)).toThrow();
    });

    it('throws when JWT_SECRET is missing outside test env', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      expect(() => generateToken({ id: 1, email: 'test@example.com', isAdmin: false })).toThrow(
        'JWT_SECRET environment variable is not set'
      );
    });

    it('throws when JWT_SECRET is weak outside test env', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'change-this';

      expect(() => generateToken({
        id: 1,
        email: 'test@example.com',
        isAdmin: false,
        sessionVersion: 'session-v1',
      })).toThrow('JWT_SECRET is too weak');
    });

    it('derives deterministic session version from password hash', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';

      const v1 = deriveSessionVersion('hashed-password-a');
      const v2 = deriveSessionVersion('hashed-password-a');
      const v3 = deriveSessionVersion('hashed-password-b');

      expect(v1).toHaveLength(32);
      expect(v1).toBe(v2);
      expect(v1).not.toBe(v3);
    });
  });
});
