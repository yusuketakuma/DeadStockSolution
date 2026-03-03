import { describe, it, expect } from 'vitest';
import { sanitizeInternalPath } from '../navigation';

describe('sanitizeInternalPath', () => {
  it('returns valid path as-is', () => {
    expect(sanitizeInternalPath('/dashboard', '/home')).toBe('/dashboard');
  });

  it('returns fallback for invalid path', () => {
    expect(sanitizeInternalPath('invalid', '/home')).toBe('/home');
  });

  it('returns fallback for null path', () => {
    expect(sanitizeInternalPath(null, '/home')).toBe('/home');
  });

  it('returns fallback for undefined path', () => {
    expect(sanitizeInternalPath(undefined, '/home')).toBe('/home');
  });

  it('returns fallback for empty path', () => {
    expect(sanitizeInternalPath('', '/home')).toBe('/home');
  });

  it('rejects path starting with //', () => {
    expect(sanitizeInternalPath('//evil.com', '/home')).toBe('/home');
  });

  it('rejects path starting with /\\', () => {
    expect(sanitizeInternalPath('/\\evil', '/home')).toBe('/home');
  });

  it('rejects path without leading slash', () => {
    expect(sanitizeInternalPath('dashboard', '/home')).toBe('/home');
  });

  it('rejects path with control chars', () => {
    expect(sanitizeInternalPath('/foo\x00bar', '/home')).toBe('/home');
  });

  it('returns valid path when fallback is empty string', () => {
    expect(sanitizeInternalPath('/valid', '')).toBe('/valid');
  });

  it('returns empty string when path is invalid and fallback is empty string', () => {
    expect(sanitizeInternalPath('invalid', '')).toBe('');
  });

  it('defaults to / when fallback is invalid', () => {
    expect(sanitizeInternalPath(null, 'bad-fallback')).toBe('/');
  });

  it('trims whitespace from path', () => {
    expect(sanitizeInternalPath('  /path  ', '/home')).toBe('/path');
  });

  it('returns fallback for whitespace-only path', () => {
    expect(sanitizeInternalPath('   ', '/home')).toBe('/home');
  });

  it('rejects path with DEL char (0x7F)', () => {
    expect(sanitizeInternalPath('/foo\x7Fbar', '/home')).toBe('/home');
  });
});
