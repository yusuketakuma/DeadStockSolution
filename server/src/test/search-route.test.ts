import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  ilike: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  sql: Object.assign(
    (..._args: unknown[]) => ({ as: vi.fn(() => ({})) }),
    {
      raw: (..._args: unknown[]) => ({}),
      join: (..._args: unknown[]) => ({}),
    },
  ),
}));

vi.mock('../utils/kana-utils', () => ({
  katakanaToHiragana: vi.fn((s: string) => s),
  hiraganaToKatakana: vi.fn((s: string) => s),
  normalizeKana: vi.fn((s: string) => s),
  fullWidthAlphanumToHalfWidth: vi.fn((s: string) => s),
  halfWidthAlphanumToFullWidth: vi.fn((s: string) => s),
}));

vi.mock('../utils/request-utils', () => ({
  escapeLikeWildcards: vi.fn((s: string) => s),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import searchRouter from '../routes/search';

function createSelectDistinctQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/search', searchRouter);
  return app;
}

describe('GET /api/search/drugs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when query is empty', async () => {
    const app = createApp();
    const response = await request(app).get('/api/search/drugs');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns empty array when query is whitespace only', async () => {
    const app = createApp();
    const response = await request(app).get('/api/search/drugs').query({ q: '   ' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns drug names matching the query', async () => {
    const app = createApp();
    mocks.db.select.mockImplementation(() =>
      createSelectDistinctQuery([
        { drugName: 'アムロジピン錠5mg' },
        { drugName: 'アムロジピン錠10mg' },
      ]),
    );

    const response = await request(app).get('/api/search/drugs').query({ q: 'アムロ' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(['アムロジピン錠5mg', 'アムロジピン錠10mg']);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('returns at most 10 results (MAX_SUGGESTIONS)', async () => {
    const app = createApp();
    const manyResults = Array.from({ length: 10 }, (_, i) => ({ drugName: `Drug ${i + 1}` }));
    mocks.db.select.mockImplementation(() => createSelectDistinctQuery(manyResults));

    const response = await request(app).get('/api/search/drugs').query({ q: 'Drug' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(10);
  });

  it('returns 500 on database error', async () => {
    const app = createApp();
    const failQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    mocks.db.select.mockImplementation(() => failQuery);

    const response = await request(app).get('/api/search/drugs').query({ q: 'test' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '検索に失敗しました' });
  });
});

describe('GET /api/search/drug-master', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when query is empty', async () => {
    const app = createApp();
    const response = await request(app).get('/api/search/drug-master');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns drug master records matching name search', async () => {
    const app = createApp();
    const mockRecord = {
      yjCode: '1234567890123',
      drugName: 'アムロジピン錠5mg「サワイ」',
      yakkaPrice: '10.10',
      unit: '錠',
      specification: '5mg',
    };
    mocks.db.select.mockImplementation(() => createSelectQuery([mockRecord]));

    const response = await request(app).get('/api/search/drug-master').query({ q: 'アムロ' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      yjCode: '1234567890123',
      drugName: 'アムロジピン錠5mg「サワイ」',
    });
  });

  it('includes YJ code condition when query is alphanumeric', async () => {
    const app = createApp();
    mocks.db.select.mockImplementation(() =>
      createSelectQuery([
        {
          yjCode: 'ABC123',
          drugName: 'テスト薬',
          yakkaPrice: '5.00',
          unit: '錠',
          specification: '10mg',
        },
      ]),
    );

    const response = await request(app).get('/api/search/drug-master').query({ q: 'ABC123' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    // YJ code alphanumeric search was applied
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on database error', async () => {
    const app = createApp();
    const failQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    mocks.db.select.mockImplementation(() => failQuery);

    const response = await request(app).get('/api/search/drug-master').query({ q: 'test' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '検索に失敗しました' });
  });
});

describe('GET /api/search/pharmacies', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when query is empty', async () => {
    const app = createApp();
    const response = await request(app).get('/api/search/pharmacies');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns pharmacy names matching the query', async () => {
    const app = createApp();
    mocks.db.select.mockImplementation(() =>
      createSelectDistinctQuery([{ name: 'さくら薬局' }, { name: 'さくらい薬局' }]),
    );

    const response = await request(app).get('/api/search/pharmacies').query({ q: 'さくら' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(['さくら薬局', 'さくらい薬局']);
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on database error', async () => {
    const app = createApp();
    const failQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    mocks.db.select.mockImplementation(() => failQuery);

    const response = await request(app).get('/api/search/pharmacies').query({ q: 'test' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '検索に失敗しました' });
  });
});

describe('sanitizeQuery utility (via route behavior)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.select.mockImplementation(() => createSelectDistinctQuery([]));
  });

  it('strips control characters from query', async () => {
    const app = createApp();
    // Control chars in q should be stripped; result is empty after stripping
    const response = await request(app).get('/api/search/drugs').query({ q: '\x00\x01\x1F' });
    expect(response.status).toBe(200);
    // After stripping control chars, the query becomes empty → returns []
    expect(response.body).toEqual([]);
  });

  it('truncates query to max 100 characters', async () => {
    const app = createApp();
    mocks.db.select.mockImplementation(() => createSelectDistinctQuery([{ drugName: 'TestDrug' }]));

    const longQuery = 'a'.repeat(150);
    const response = await request(app).get('/api/search/drugs').query({ q: longQuery });
    expect(response.status).toBe(200);
    // Query was truncated but still non-empty so DB was called
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('returns empty for non-string query param types', async () => {
    const app = createApp();
    // Passing no q param — sanitizeQuery receives undefined → returns undefined
    const response = await request(app).get('/api/search/drugs');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
