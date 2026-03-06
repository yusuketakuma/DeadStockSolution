import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../utils/cursor-pagination';

describe('encodeCursor', () => {
  it('encodes a simple object', () => {
    const encoded = encodeCursor({ id: 1 });
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('encodes a nested object', () => {
    const encoded = encodeCursor({ filter: { status: 'active' }, page: 2 });
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('roundtrips with decodeCursor', () => {
    const original = { id: 42, name: 'test', nested: { a: 1 } };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });
});

describe('decodeCursor', () => {
  it('decodes a valid cursor', () => {
    const cursor = encodeCursor({ page: 3 });
    const result = decodeCursor<{ page: number }>(cursor);
    expect(result).toEqual({ page: 3 });
  });

  it('returns null for invalid base64', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for number', () => {
    expect(decodeCursor(123)).toBeNull();
  });

  it('returns null for non-object JSON string value', () => {
    const encoded = Buffer.from(JSON.stringify('just a string'), 'utf-8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for JSON number value', () => {
    const encoded = Buffer.from(JSON.stringify(42), 'utf-8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for JSON true value', () => {
    const encoded = Buffer.from(JSON.stringify(true), 'utf-8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for JSON null value', () => {
    const encoded = Buffer.from(JSON.stringify(null), 'utf-8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(decodeCursor('   ')).toBeNull();
  });

  it('returns array for JSON array (typeof array is object)', () => {
    const encoded = Buffer.from(JSON.stringify([1, 2, 3]), 'utf-8').toString('base64url');
    const result = decodeCursor(encoded);
    expect(result).toEqual([1, 2, 3]);
  });
});
