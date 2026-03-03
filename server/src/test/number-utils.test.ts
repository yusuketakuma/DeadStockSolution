import { describe, it, expect } from 'vitest';
import { parseBoundedInt, parseBooleanFlag } from '../utils/number-utils';

describe('parseBoundedInt', () => {
  it('returns parsed int for valid input', () => {
    expect(parseBoundedInt('5', 0, 1, 10)).toBe(5);
  });

  it('floors float values', () => {
    expect(parseBoundedInt('5.9', 0, 1, 10)).toBe(5);
  });

  it('returns fallback when below min', () => {
    expect(parseBoundedInt('0', 99, 1, 10)).toBe(99);
  });

  it('returns fallback when above max', () => {
    expect(parseBoundedInt('11', 99, 1, 10)).toBe(99);
  });

  it('returns fallback for undefined', () => {
    expect(parseBoundedInt(undefined, 42, 1, 100)).toBe(42);
  });

  it('returns fallback for NaN string', () => {
    expect(parseBoundedInt('abc', 42, 1, 100)).toBe(42);
  });

  it('returns fallback for Infinity', () => {
    expect(parseBoundedInt('Infinity', 42, 1, 100)).toBe(42);
  });

  it('returns fallback for empty string', () => {
    expect(parseBoundedInt('', 42, 1, 100)).toBe(42);
  });

  it('handles negative range', () => {
    expect(parseBoundedInt('-5', 0, -10, -1)).toBe(-5);
  });

  it('returns value at exact min boundary', () => {
    expect(parseBoundedInt('1', 0, 1, 10)).toBe(1);
  });

  it('returns value at exact max boundary', () => {
    expect(parseBoundedInt('10', 0, 1, 10)).toBe(10);
  });

  it('returns fallback for negative Infinity', () => {
    expect(parseBoundedInt('-Infinity', 42, 1, 100)).toBe(42);
  });

  it('floors negative floats toward zero', () => {
    expect(parseBoundedInt('-3.7', 0, -10, -1)).toBe(-4);
  });
});

describe('parseBooleanFlag', () => {
  it('returns true for "true"', () => {
    expect(parseBooleanFlag('true', false)).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseBooleanFlag('false', true)).toBe(false);
  });

  it('handles uppercase "TRUE"', () => {
    expect(parseBooleanFlag('TRUE', false)).toBe(true);
  });

  it('handles mixed case with whitespace " True "', () => {
    expect(parseBooleanFlag(' True ', false)).toBe(true);
  });

  it('returns fallback for undefined', () => {
    expect(parseBooleanFlag(undefined, true)).toBe(true);
    expect(parseBooleanFlag(undefined, false)).toBe(false);
  });

  it('returns fallback for empty string', () => {
    expect(parseBooleanFlag('', false)).toBe(false);
  });

  it('returns fallback for "yes"', () => {
    expect(parseBooleanFlag('yes', false)).toBe(false);
  });

  it('returns fallback for "1"', () => {
    expect(parseBooleanFlag('1', false)).toBe(false);
  });

  it('returns fallback for "0"', () => {
    expect(parseBooleanFlag('0', true)).toBe(true);
  });

  it('returns fallback true for unrecognized value', () => {
    expect(parseBooleanFlag('maybe', true)).toBe(true);
  });

  it('returns fallback false for unrecognized value', () => {
    expect(parseBooleanFlag('maybe', false)).toBe(false);
  });

  it('handles "FALSE" uppercase', () => {
    expect(parseBooleanFlag('FALSE', true)).toBe(false);
  });

  it('handles " false " with whitespace', () => {
    expect(parseBooleanFlag(' false ', true)).toBe(false);
  });
});
