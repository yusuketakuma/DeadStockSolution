const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
const API_BASE = configuredApiBase
  ? configuredApiBase.replace(/\/+$/, '')
  : '/api';
const REQUEST_TIMEOUT_MS = 30000;
const CSRF_EXEMPT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/auth/csrf-token',
];

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export interface FieldError {
  field: string;
  message: string;
}

class ApiError extends Error {
  public fieldErrors?: FieldError[];
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'ApiError';
    if (data && typeof data === 'object' && 'errors' in data && Array.isArray((data as Record<string, unknown>).errors)) {
      this.fieldErrors = (data as Record<string, unknown>).errors as FieldError[];
    }
  }
}

type AuthExpiredHandler = () => void;
let onAuthExpired: AuthExpiredHandler | null = null;
let csrfTokenCache: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

export function setAuthExpiredHandler(handler: AuthExpiredHandler): void {
  onAuthExpired = handler;
}

function requiresCsrf(method: string, path: string): boolean {
  if (import.meta.env.MODE === 'test') {
    return false;
  }
  const upperMethod = method.toUpperCase();
  const isSafeMethod = upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS';
  if (isSafeMethod) return false;
  return !CSRF_EXEMPT_PATHS.some((prefix) => path.startsWith(prefix));
}

async function requestCsrfToken(timeout: number): Promise<string> {
  const response = await fetchWithTimeout(`${API_BASE}/auth/csrf-token`, {
    method: 'GET',
    credentials: 'include',
  }, timeout);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'CSRFトークンの取得に失敗しました', data);
  }
  const data = await response.json().catch(() => ({}));
  const token = typeof data?.csrfToken === 'string' ? data.csrfToken : '';
  if (!token) {
    throw new ApiError(0, 'CSRFトークンの取得に失敗しました');
  }
  csrfTokenCache = token;
  return token;
}

async function ensureCsrfToken(timeout: number): Promise<string> {
  if (csrfTokenCache) return csrfTokenCache;
  if (!csrfTokenPromise) {
    csrfTokenPromise = requestCsrfToken(timeout).finally(() => {
      csrfTokenPromise = null;
    });
  }
  return csrfTokenPromise;
}

async function fetchWithTimeout(
  url: string,
  config: RequestInit,
  timeout: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...config, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new ApiError(0, 'リクエストがキャンセルされました');
      }
      throw new ApiError(0, 'リクエストがタイムアウトしました');
    }
    throw new ApiError(0, 'ネットワークエラーが発生しました');
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function parseSuccessResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeout = REQUEST_TIMEOUT_MS,
    signal,
  } = options;
  const shouldUseCsrf = requiresCsrf(method, path);

  const config: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  if (shouldUseCsrf) {
    const csrfToken = await ensureCsrfToken(timeout);
    (config.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
  }

  const doRequest = () => fetchWithTimeout(`${API_BASE}${path}`, config, timeout, signal);
  let response = await doRequest();

  if (!response.ok && shouldUseCsrf && response.status === 403) {
    csrfTokenCache = null;
    const csrfToken = await ensureCsrfToken(timeout);
    (config.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
    response = await doRequest();
  }

  if (!response.ok) {
    if (response.status === 401) {
      csrfTokenCache = null;
      onAuthExpired?.();
    }
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'リクエストに失敗しました', data);
  }

  return parseSuccessResponse<T>(response);
}

interface UploadOptions {
  signal?: AbortSignal;
}

export async function apiUpload<T>(path: string, formData: FormData, options: UploadOptions = {}): Promise<T> {
  const { signal } = options;
  const config: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {},
    body: formData,
  };
  if (requiresCsrf('POST', path)) {
    const csrfToken = await ensureCsrfToken(60000);
    (config.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
  }

  let response = await fetchWithTimeout(`${API_BASE}${path}`, config, 60000, signal);
  if (!response.ok && response.status === 403 && requiresCsrf('POST', path)) {
    csrfTokenCache = null;
    const csrfToken = await ensureCsrfToken(60000);
    (config.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
    response = await fetchWithTimeout(`${API_BASE}${path}`, config, 60000, signal);
  }

  if (!response.ok) {
    if (response.status === 401) {
      csrfTokenCache = null;
      onAuthExpired?.();
    }
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'アップロードに失敗しました', data);
  }

  return parseSuccessResponse<T>(response);
}

export const api = {
  get: <T>(path: string, options: Pick<ApiOptions, 'timeout' | 'signal'> = {}) =>
    apiRequest<T>(path, options),
  post: <T>(
    path: string,
    body?: unknown,
    options: Pick<ApiOptions, 'headers' | 'timeout' | 'signal'> = {},
  ) => apiRequest<T>(path, { method: 'POST', body, ...options }),
  put: <T>(
    path: string,
    body?: unknown,
    options: Pick<ApiOptions, 'headers' | 'timeout' | 'signal'> = {},
  ) => apiRequest<T>(path, { method: 'PUT', body, ...options }),
  patch: <T>(
    path: string,
    body?: unknown,
    options: Pick<ApiOptions, 'headers' | 'timeout' | 'signal'> = {},
  ) => apiRequest<T>(path, { method: 'PATCH', body, ...options }),
  delete: <T>(
    path: string,
    body?: unknown,
    options: Pick<ApiOptions, 'headers' | 'timeout' | 'signal'> = {},
  ) => apiRequest<T>(path, { method: 'DELETE', body, ...options }),
  upload: apiUpload,
};

/**
 * 409 Conflict エラーかどうかを判定する。
 * 楽観的ロック競合時に使用。
 */
export function isConflictError(err: unknown): err is ApiError & { data: { latestData: unknown } } {
  return err instanceof ApiError && err.status === 409 && err.data != null && typeof err.data === 'object' && 'latestData' in err.data;
}

export { ApiError };
