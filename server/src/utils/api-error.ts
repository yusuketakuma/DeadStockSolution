/**
 * 統一されたAPIエラーハンドリング
 * 
 * 使用例:
 *   throw new ApiError(400, '不正なリクエストです', 'INVALID_REQUEST');
 *   throw new ApiError.notFound('アカウントが見つかりません');
 *   throw new ApiError.unauthorized('ログインが必要です');
 */

export type ErrorCode = 
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode | string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, code: ErrorCode | string = 'INTERNAL_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    
    // Proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  // Factory methods for common HTTP errors
  static badRequest(message: string, code: string = 'BAD_REQUEST', details?: Record<string, unknown>): ApiError {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message: string = '認証が必要です', code: string = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, message, code);
  }

  static forbidden(message: string = 'アクセス権限がありません', code: string = 'FORBIDDEN'): ApiError {
    return new ApiError(403, message, code);
  }

  static notFound(message: string = 'リソースが見つかりません', code: string = 'NOT_FOUND'): ApiError {
    return new ApiError(404, message, code);
  }

  static conflict(message: string, code: string = 'CONFLICT', details?: Record<string, unknown>): ApiError {
    return new ApiError(409, message, code, details);
  }

  static validationError(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(400, message, 'VALIDATION_ERROR', details);
  }

  static internal(message: string = 'サーバーエラーが発生しました', code: string = 'INTERNAL_ERROR'): ApiError {
    return new ApiError(500, message, code);
  }

  // Convert to response body
  toBody(): ApiErrorBody {
    const body: ApiErrorBody = {
      error: this.message,
      code: this.code,
    };
    if (this.details) {
      body.details = this.details;
    }
    return body;
  }
}

// Type guard to check if error is ApiError
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
