import { describe, it, expect } from 'vitest';
import {
  isVerified,
  isPendingVerification,
  canLogin,
  detectChangedReverificationFields,
  isVerificationRequestType,
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
    it('returns true for pending + active (re-verification allows login)', () => {
      expect(canLogin('pending_verification', true)).toBe(true);
    });
    it('returns false for verified + inactive', () => {
      expect(canLogin('verified', false)).toBe(false);
    });
    it('returns false for pending + inactive (new registration)', () => {
      expect(canLogin('pending_verification', false)).toBe(false);
    });
  });

  describe('detectChangedReverificationFields', () => {
    it('returns only actually changed reverification fields', () => {
      const changed = detectChangedReverificationFields(
        {
          name: '旧薬局',
          address: '東京都千代田区',
          phone: '03-0000-0000',
        },
        {
          name: '新薬局',
          address: '東京都千代田区',
          phone: '03-0000-0000',
          version: 3,
        },
      );

      expect(changed).toEqual(['name']);
    });
  });

  describe('isVerificationRequestType', () => {
    it('returns true for supported verification request types', () => {
      expect(isVerificationRequestType('pharmacy_verification')).toBe(true);
      expect(isVerificationRequestType('pharmacy_reverification')).toBe(true);
    });

    it('returns false for unsupported request types', () => {
      expect(isVerificationRequestType('other')).toBe(false);
      expect(isVerificationRequestType(null)).toBe(false);
    });
  });
});
