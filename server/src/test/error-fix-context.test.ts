import { describe, expect, it } from 'vitest';
import { extractSourceLocation, buildErrorFixContext } from '../services/error-fix-context';

describe('extractSourceLocation', () => {
  it('should extract file and line from stack trace', () => {
    const stack = `Error: something failed
    at Object.<anonymous> (/Users/x/server/src/services/upload-service.ts:42:10)
    at Module._compile (node:internal/modules/cjs/loader:1241:14)`;
    const loc = extractSourceLocation(stack);
    expect(loc).toEqual({
      file: 'server/src/services/upload-service.ts',
      line: 42,
    });
  });

  it('should return null for non-project stack frames', () => {
    const stack = `Error: fail
    at Module._compile (node:internal/modules/cjs/loader:1241:14)`;
    expect(extractSourceLocation(stack)).toBeNull();
  });

  it('should return null for undefined stack', () => {
    expect(extractSourceLocation(undefined)).toBeNull();
  });
});

describe('buildErrorFixContext', () => {
  it('should build context with all fields', () => {
    const err = new Error('DB connection timeout');
    err.stack = `Error: DB connection timeout
    at Object.<anonymous> (/Users/x/server/src/services/exchange-service.ts:100:5)`;
    const ctx = buildErrorFixContext({
      err,
      method: 'POST',
      path: '/api/exchange/propose',
      status: 500,
      sentryEventId: 'abc123',
    });
    expect(ctx.errorMessage).toBe('DB connection timeout');
    expect(ctx.sourceFile).toBe('server/src/services/exchange-service.ts');
    expect(ctx.sourceLine).toBe(100);
    expect(ctx.endpoint).toBe('POST /api/exchange/propose');
    expect(ctx.sentryEventId).toBe('abc123');
    expect(typeof ctx.timestamp).toBe('string');
  });

  it('should handle non-Error objects', () => {
    const ctx = buildErrorFixContext({
      err: 'string error',
      method: 'GET',
      path: '/api/test',
      status: 500,
      sentryEventId: null,
    });
    expect(ctx.errorMessage).toBe('string error');
    expect(ctx.sourceFile).toBeNull();
  });
});
