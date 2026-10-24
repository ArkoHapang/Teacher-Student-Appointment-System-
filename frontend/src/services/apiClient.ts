/**
 * Centralized API Client
 * Manages authentication headers, response schemas, error interception (401/403/409), and JSON serialization.
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

const TOKEN_KEY = 'ts_auth_token';
const USER_KEY = 'ts_auth_user';

export const apiClient = {
  setToken(token: string | null) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  },

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  onUnauthorized(handler: UnauthorizedHandler) {
    unauthorizedListener = handler;
  },

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data: T; message?: string }> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>)
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: options.credentials || 'include'
    });

    // Handle session expiration & unauthorized
    if (response.status === 401) {
      this.setToken(null);
      if (unauthorizedListener) {
        unauthorizedListener();
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

  post<T>(endpoint: string, body?: unknown): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  patch<T>(endpoint: string, body?: unknown): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  delete<T>(endpoint: string): Promise<{ success: boolean; data: T; message?: string }> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
};
