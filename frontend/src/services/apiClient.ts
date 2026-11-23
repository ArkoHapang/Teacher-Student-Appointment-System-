/**
 * Centralized API Client
 * Manages cookie-authenticated requests, CSRF defense headers, response schemas,
 * error interception (401/403/409), and JSON serialization.
 */

import { ApiErrorPayload } from '../types/admin';

export class ApiError extends Error {
  public status: number;
  public code: string;
  public details: unknown[];

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code || 'UNKNOWN_ERROR';
    this.details = payload.details || [];
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedListener: UnauthorizedHandler | null = null;
let hasNotifiedUnauthorized = false;

const USER_KEY = 'ts_auth_user';

/**
 * Production Deployment Architecture:
 * Strictly routes all API calls through the same-origin Netlify /api/* proxy rewrite.
 * Direct cross-origin mode is explicitly disabled for this deployment to guarantee
 * first-party HttpOnly session cookies and Sec-Fetch-Site: same-origin CSRF compliance.
 */
const getApiBaseUrl = (): string => '';

export const apiClient = {
  onUnauthorized(handler: UnauthorizedHandler) {
    unauthorizedListener = handler;
  },

  resetUnauthorizedGuard() {
    hasNotifiedUnauthorized = false;
  },

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data: T; message?: string }> {
    const method = (options.method || 'GET').toUpperCase();
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as Record<string, string>)
    };

    // Add CSRF defense header on state-changing requests
    if (isMutation) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }

    // Explicitly negotiate cookie-only mode on authentication entrypoints
    if (endpoint.endsWith('/auth/login') || endpoint.endsWith('/auth/register')) {
      headers['X-Session-Mode'] = 'cookie-only';
    }

    // Set Content-Type: application/json for requests with a body, unless it's FormData
    if (!(options.body instanceof FormData) && !headers['Content-Type'] && options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const baseUrl = getApiBaseUrl();
    const targetUrl = (baseUrl && endpoint.startsWith('/')) ? `${baseUrl}${endpoint}` : endpoint;

    const response = await fetch(targetUrl, {
      ...options,
      headers,
      credentials: 'include'
    });

    // Handle session expiration & unauthorized
    if (response.status === 401) {
      const isAuthEntrypoint = endpoint.endsWith('/auth/login') || endpoint.endsWith('/auth/register');
      if (!isAuthEntrypoint) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(USER_KEY);
            localStorage.removeItem('ts_auth_token'); // Ensure legacy storage is cleared
          }
        } catch {
          // Safe storage access
        }
        if (!hasNotifiedUnauthorized) {
          hasNotifiedUnauthorized = true;
          if (unauthorizedListener) {
            unauthorizedListener();
          }
        }
      }
    }

    let payload: { success?: boolean; data?: T; error?: ApiErrorPayload; message?: string };
    try {
      payload = await response.json();
    } catch {
      payload = {
        success: false,
        error: {
          code: 'INVALID_JSON_RESPONSE',
          message: `Server returned HTTP ${response.status} with non-JSON response.`
        }
      };
    }

    if (!response.ok || payload.success === false) {
      const errorPayload: ApiErrorPayload = payload.error || {
        code: `HTTP_${response.status}`,
        message: payload.message || `Request failed with HTTP status ${response.status}`
      };
      throw new ApiError(response.status, errorPayload);
    }

    return {
      success: true,
      data: payload.data as T,
      message: payload.message
    };
  },

  get<T>(endpoint: string, queryParams?: Record<string, string | number | boolean | undefined>): Promise<{ success: boolean; data: T; message?: string }> {
    let url = endpoint;
    if (queryParams) {
      const filtered = Object.entries(queryParams)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (filtered) {
        url += (url.includes('?') ? '&' : '?') + filtered;
      }
    }
    return this.request<T>(url, { method: 'GET' });
  },

  post<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
  },

  patch<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
  },

  delete<T>(endpoint: string, options?: RequestInit): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
};
