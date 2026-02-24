const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 30000;

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
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

export function setAuthExpiredHandler(handler: AuthExpiredHandler): void {
  onAuthExpired = handler;
}

async function fetchWithTimeout(url: string, config: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...config, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'リクエストがタイムアウトしました');
    }
    throw new ApiError(0, 'ネットワークエラーが発生しました');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = REQUEST_TIMEOUT_MS } = options;

  const config: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetchWithTimeout(`${API_BASE}${path}`, config, timeout);

  if (!response.ok) {
    if (response.status === 401) {
      onAuthExpired?.();
    }
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'リクエストに失敗しました', data);
  }

  return response.json();
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }, 60000);

  if (!response.ok) {
    if (response.status === 401) {
      onAuthExpired?.();
    }
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error || 'アップロードに失敗しました', data);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: apiUpload,
};

export { ApiError };
