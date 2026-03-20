import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@workos-inc/node', () => ({
  WorkOS: class WorkOS {},
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock('../utils/email-utils', () => ({
  eqEmailCaseInsensitive: vi.fn((column: unknown, email: string) => ({ column, email })),
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

function createSelectChain(result: unknown) {
  const resolved = Promise.resolve(result);
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue(resolved);
  return chain;
}

describe('workos-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats unverified WorkOS users as an auth failure instead of onboarding', async () => {
    mocks.db.select
      .mockReturnValueOnce(createSelectChain([]));

    const { findOrLinkPharmacy } = await import('../services/workos-service');
    const result = await findOrLinkPharmacy({
      id: 'user_123',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      emailVerified: false,
    });

    expect(result).toEqual({
      pharmacy: null,
      isNewUser: true,
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'WorkOS user email not verified, skipping auto-link',
      expect.objectContaining({
        workosUserId: 'user_123',
        email: 'user@example.com',
      }),
    );
  });
});
