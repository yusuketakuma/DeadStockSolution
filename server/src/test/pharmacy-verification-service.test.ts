import { describe, it, expect } from 'vitest';
import {
  type VerificationStatus,
  isVerified,
  isPendingVerification,
  canLogin,
} from '../services/pharmacy-verification-service';

describe('pharmacy-verification-service', () => {
  describe('isVerified', () => {
    it('returns true for verified status', () => {
      expect(isVerified('verified')).toBe(true);
    });
    it('returns false for pending_verification', () => {
      expect(isVerified('pending_verification')).toBe(false);
    });
    it('returns false for rejected', () => {
      expect(isVerified('rejected')).toBe(false);
    });
  });

  describe('isPendingVerification', () => {
    it('returns true for pending_verification', () => {
      expect(isPendingVerification('pending_verification')).toBe(true);
    });
    it('returns false for verified', () => {
      expect(isPendingVerification('verified')).toBe(false);
    });
  });

  describe('canLogin', () => {
    it('returns true for verified + active', () => {
      expect(canLogin('verified', true)).toBe(true);
    });
    it('returns false for pending + active', () => {
      expect(canLogin('pending_verification', true)).toBe(false);
    });
    it('returns false for verified + inactive', () => {
      expect(canLogin('verified', false)).toBe(false);
    });
    it('returns true for unverified + active (legacy)', () => {
      expect(canLogin('unverified', true)).toBe(true);
    });
  });
});
