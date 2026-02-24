import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../services/auth-service';

describe('auth-service', () => {
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
  });
});
