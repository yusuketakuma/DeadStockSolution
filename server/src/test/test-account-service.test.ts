import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  hashPassword: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/auth-service', () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));

import { ensureTestAccountsSeededIfEnabled } from '../services/test-account-service';

function createSelectQuery(result: unknown, error?: Error) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  if (error) {
    query.limit.mockRejectedValue(error);
  } else {
    query.limit.mockResolvedValue(result);
  }
  return query;
}

function createInsertQuery(result: unknown) {
  const query = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  query.values.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

describe('test-account-service ensure seed retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.ENABLE_TEST_PHARMACY_ACCOUNTS = 'true';
    process.env.TEST_ACCOUNT_PASSWORD = 'password123';
    mocks.hashPassword.mockResolvedValue('hashed-password');
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    delete process.env.ENABLE_TEST_PHARMACY_ACCOUNTS;
    delete process.env.TEST_ACCOUNT_PASSWORD;
  });

  it('retries automatically after transient seed failure', async () => {
    mocks.db.select
      .mockImplementationOnce(() => createSelectQuery(null, new Error('temporary database error')))
      .mockImplementation(() => createSelectQuery([]));

    let nextId = 100;
    mocks.db.insert.mockImplementation(() => createInsertQuery([{
      id: nextId++,
      email: 'test@example.com',
      name: 'テスト薬局',
      prefecture: '東京都',
      isAdmin: false,
    }]));

    await ensureTestAccountsSeededIfEnabled();

    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to seed test pharmacy accounts',
      expect.objectContaining({ error: 'temporary database error' })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Test pharmacy seed retry scheduled',
      expect.objectContaining({ delayMs: 15000 })
    );

    await vi.advanceTimersByTimeAsync(15000);

    expect(mocks.db.insert).toHaveBeenCalledTimes(2);
    expect(mocks.loggerInfo).toHaveBeenCalledWith('Test pharmacy accounts are ready', { count: 2 });
  });
});
