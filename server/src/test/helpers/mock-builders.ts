import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { vi } from 'vitest';

/**
 * Create an Express app with inline auth middleware that injects a test user.
 * Avoids vi.mock('../middleware/auth') interference between test files.
 */
export function createAuthenticatedApp(
  basePath: string,
  router: Router,
  user: { id: number; email: string; isAdmin: boolean } = { id: 1, email: 'test@example.com', isAdmin: false },
) {
  const app = express();
  app.use(express.json());
  app.use(basePath, (_req: Request, _res: Response, next: NextFunction) => {
    (_req as unknown as { user: typeof user }).user = user;
    next();
  }, router);
  return app;
}

export function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

export function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

export function createOrderByQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(result);
  return query;
}

export function createSubQueryBuilder() {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    groupBy: vi.fn(),
    innerJoin: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  return query;
}

export function createSelectWhereChain(result: unknown) {
  const selectWhere = vi.fn().mockResolvedValue(result);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    select,
    selectFrom,
    selectWhere,
  };
}

export function createSelectLimitChain(result: unknown) {
  const selectLimit = vi.fn().mockResolvedValue(result);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    select,
    selectFrom,
    selectWhere,
    selectLimit,
  };
}

export function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

export function createSimpleSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

export function createUpdateReturningQuery(result: unknown) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

export function createInsertReturningQuery(result: unknown) {
  const query = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  query.values.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

export function createInsertQuery() {
  const query = {
    values: vi.fn(),
  };
  query.values.mockResolvedValue(undefined);
  return query;
}

export function createDeleteQuery() {
  const query = {
    where: vi.fn(),
  };
  query.where.mockResolvedValue(undefined);
  return query;
}

export function createGroupByQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockResolvedValue(result);
  return query;
}
