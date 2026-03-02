import { describe, it, expect } from 'vitest';
import { validateRegistration, validateLogin } from '../utils/validators';

describe('validateRegistration', () => {
  const validData = {
    email: 'test@example.com',
    password: 'Password1',
    name: 'テスト薬局',
    postalCode: '100-0001',
    address: '東京都千代田区1-1-1',
    phone: '03-1234-5678',
    fax: '03-1234-5679',
    licenseNumber: 'A12345',
    permitLicenseNumber: 'A12345',
    permitPharmacyName: 'テスト薬局',
    permitAddress: '東京都千代田区1-1-1',
    prefecture: '東京都',
  };

  it('accepts valid registration data', () => {
    expect(validateRegistration(validData)).toEqual([]);
  });

  it('trims surrounding whitespace in registration fields', () => {
    expect(validateRegistration({
      ...validData,
      email: ' test@example.com ',
      name: ' テスト薬局 ',
      permitPharmacyName: ' テスト薬局 ',
      postalCode: ' 100-0001 ',
      address: ' 東京都千代田区1-1-1 ',
      permitAddress: ' 東京都千代田区1-1-1 ',
      licenseNumber: ' A12345 ',
      permitLicenseNumber: ' A12345 ',
      phone: ' 03-1234-5678 ',
      fax: ' 03-1234-5679 ',
      prefecture: ' 東京都 ',
    })).toEqual([]);
  });

  it('rejects invalid email format', () => {
    const errors = validateRegistration({ ...validData, email: 'invalid' });
    expect(errors.some((e) => e.field === 'email')).toBe(true);
  });

  it('rejects email without TLD', () => {
    const errors = validateRegistration({ ...validData, email: 'a@b' });
    expect(errors.some((e) => e.field === 'email')).toBe(true);
  });

  it('accepts proper email with domain', () => {
    const errors = validateRegistration({ ...validData, email: 'user@domain.co.jp' });
    expect(errors).toEqual([]);
  });

  it('rejects password shorter than 8 chars', () => {
    const errors = validateRegistration({ ...validData, password: 'short1' });
    expect(errors.some((e) => e.field === 'password')).toBe(true);
  });

  it('rejects password without digits', () => {
    const errors = validateRegistration({ ...validData, password: 'NoDigitsHere' });
    expect(errors.some((e) => e.field === 'password')).toBe(true);
  });

  it('rejects password without letters', () => {
    const errors = validateRegistration({ ...validData, password: '12345678' });
    expect(errors.some((e) => e.field === 'password')).toBe(true);
  });

  it('accepts strong password', () => {
    const errors = validateRegistration({ ...validData, password: 'SecurePass123' });
    expect(errors).toEqual([]);
  });

  it('rejects empty name', () => {
    const errors = validateRegistration({ ...validData, name: '' });
    expect(errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects invalid postal code', () => {
    const errors = validateRegistration({ ...validData, postalCode: '123' });
    expect(errors.some((e) => e.field === 'postalCode')).toBe(true);
  });

  it('accepts postal code with hyphens', () => {
    const errors = validateRegistration({ ...validData, postalCode: '100-0001' });
    expect(errors).toEqual([]);
  });

  it('accepts postal code without hyphens', () => {
    const errors = validateRegistration({ ...validData, postalCode: '1000001' });
    expect(errors).toEqual([]);
  });

  it('rejects invalid phone number', () => {
    const errors = validateRegistration({ ...validData, phone: 'abc' });
    expect(errors.some((e) => e.field === 'phone')).toBe(true);
  });

  it('accepts valid phone number', () => {
    const errors = validateRegistration({ ...validData, phone: '03-1234-5678' });
    expect(errors).toEqual([]);
  });

  it('rejects invalid prefecture', () => {
    const errors = validateRegistration({ ...validData, prefecture: '火星' });
    expect(errors.some((e) => e.field === 'prefecture')).toBe(true);
  });

  it('returns multiple errors for multiple invalid fields', () => {
    const errors = validateRegistration({ email: '', password: '' });
    expect(errors.length).toBeGreaterThan(2);
  });
});

describe('validateLogin', () => {
  it('accepts valid login data', () => {
    const errors = validateLogin({ email: 'test@example.com', password: 'password' });
    expect(errors).toEqual([]);
  });

  it('trims login email whitespace', () => {
    const errors = validateLogin({ email: '  test@example.com  ', password: 'password' });
    expect(errors).toEqual([]);
  });

  it('rejects empty email', () => {
    const errors = validateLogin({ email: '', password: 'password' });
    expect(errors.some((e) => e.field === 'email')).toBe(true);
  });

  it('rejects empty password', () => {
    const errors = validateLogin({ email: 'test@example.com', password: '' });
    expect(errors.some((e) => e.field === 'password')).toBe(true);
  });

  it('rejects missing fields', () => {
    const errors = validateLogin({});
    expect(errors.length).toBe(2);
  });
});
