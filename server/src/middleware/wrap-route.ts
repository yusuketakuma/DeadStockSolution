import type { Request, Response, NextFunction } from 'express';

/**
 * Express ルートハンドラの try-catch ボイラープレートを排除するラッパー。
 * catch したエラーを next() に渡し、Express のグローバルエラーハンドラに委譲する。
 *
 * @example
 * router.get('/items', wrapRoute(async (req, res) => {
 *   const items = await service.list(req.user!.id);
 *   res.json(items);
 * }));
 */
export function wrapRoute<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<void>,
): (req: Req, res: Response, next: NextFunction) => void {
  return (req: Req, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
