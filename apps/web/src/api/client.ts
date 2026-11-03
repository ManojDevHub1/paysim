import type { StandardErrorEnvelope } from '@paysim/contracts';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly envelope?: StandardErrorEnvelope;

  constructor(status: number, message: string, code = 'API_ERROR', envelope?: StandardErrorEnvelope) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.envelope = envelope;
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string;
  skipAuth?: boolean;
}

export class ApiClient {
  private baseUrl: string = '';
  private nativeToken: string | null = null;
  private csrfToken: string | null = null;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setNativeToken(token: string | null): void {
    this.nativeToken = token;
  }

  public getNativeToken(): string | null {
    return this.nativeToken;
  }

  public setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  public async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, idempotencyKey, skipAuth, headers: customHeaders, ...fetchOptions } = options;

    let url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers = new Headers(customHeaders);

    if (fetchOptions.body && typeof fetchOptions.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (!skipAuth && this.nativeToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.nativeToken}`);
    }

    if (this.csrfToken && !headers.has('X-PaySim-CSRF')) {
      headers.set('X-PaySim-CSRF', this.csrfToken);
    }

    if (idempotencyKey) {
      headers.set('Idempotency-Key', idempotencyKey);
    }

    // Always include cookies for control session handling
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let errorEnvelope: StandardErrorEnvelope | undefined;
      let errorMessage = `HTTP error ${response.status} ${response.statusText}`;
      let errorCode = 'HTTP_ERROR';

      try {
        const json = await response.json();
        if (json && typeof json === 'object' && 'error' in json && json.error) {
          errorEnvelope = json as StandardErrorEnvelope;
          errorMessage = errorEnvelope.error.message || errorMessage;
          errorCode = errorEnvelope.error.code || errorCode;
        }
      } catch {
        // Not a JSON response
      }

      throw new ApiError(response.status, errorMessage, errorCode, errorEnvelope);
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return (await response.json()) as T;
  }

  public get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
