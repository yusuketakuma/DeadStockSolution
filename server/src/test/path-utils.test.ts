import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, sanitizeInternalPath } from '../utils/path-utils';

describe('isSafeInternalPath', () => {
  it('accepts valid internal paths', () => {
    expect(isSafeInternalPath('/')).toBe(true);
    expect(isSafeInternalPath('/admin')).toBe(true);
    expect(isSafeInternalPath('/proposals/123')).toBe(true);
    expect(isSafeInternalPath('/inventory/browse?search=test')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isSafeInternalPath('')).toBe(false);
  });

  it('rejects paths not starting with /', () => {
    expect(isSafeInternalPath('admin')).toBe(false);
    expect(isSafeInternalPath('http://evil.com')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false);
  });

  it('rejects paths with non-ASCII characters', () => {
    expect(isSafeInternalPath('/パス')).toBe(false);
  });

  it('rejects paths over 200 characters', () => {
    const longPath = '/' + 'a'.repeat(201);
    expect(isSafeInternalPath(longPath)).toBe(false);
  });
});

describe('sanitizeInternalPath', () => {
  it('returns valid path as-is', () => {
    expect(sanitizeInternalPath('/admin')).toBe('/admin');
  });

  it('returns null for null input', () => {
    expect(sanitizeInternalPath(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeInternalPath(undefined)).toBeNull();
  });

  it('returns null for invalid path', () => {
    expect(sanitizeInternalPath('//evil.com')).toBeNull();
  });
});
