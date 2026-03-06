import { describe, it, expect } from 'vitest';
import { sha256 } from '../utils/crypto-utils';

describe('sha256', () => {
  it('hashes empty buffer', () => {
    const result = sha256(Buffer.alloc(0));
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes known input', () => {
    const result = sha256(Buffer.from('hello'));
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns same output for same input', () => {
    const a = sha256(Buffer.from('test'));
    const b = sha256(Buffer.from('test'));
    expect(a).toBe(b);
  });

  it('returns different output for different input', () => {
    const a = sha256(Buffer.from('abc'));
    const b = sha256(Buffer.from('def'));
    expect(a).not.toBe(b);
  });

  it('handles large buffer', () => {
    const large = Buffer.alloc(1024 * 1024, 0x42);
    const result = sha256(large);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles UTF-8 content', () => {
    const result = sha256(Buffer.from('こんにちは', 'utf-8'));
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles binary content', () => {
    const binary = Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01]);
    const result = sha256(binary);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns 64-character lowercase hex string', () => {
    const result = sha256(Buffer.from('anything'));
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });
});
