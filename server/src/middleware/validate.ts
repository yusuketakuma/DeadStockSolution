import { Request, Response, NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path[0]?.toString() || 'unknown',
    message: issue.message,
  }));
}

export function validate(schema: ZodType, target: ValidationTarget = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = req[target];
    const result = schema.safeParse(data);
    if (!result.success) {
      res.status(400).json({
        error: 'バリデーションエラー',
        errors: formatZodErrors(result.error),
      });
      return;
    }
    req[target] = result.data;
    next();
  };
}

export function validateBody(schema: ZodType) {
  return validate(schema, 'body');
}

export function validateQuery(schema: ZodType) {
  return validate(schema, 'query');
}

export function validateParams(schema: ZodType) {
  return validate(schema, 'params');
}
