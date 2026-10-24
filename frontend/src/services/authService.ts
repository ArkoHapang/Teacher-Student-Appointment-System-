/**
 * Authentication Service (Frontend)
 * Coordinates with backend /api/v1/auth endpoints.
 */

import { apiClient } from './apiClient';
import { UserRole, UserStatus } from '../types/designSystem';

export interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  createdAt?: string;
  profile?: any;
}

const USER_KEY = 'ts_auth_user';

export const authService = {
  getStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  setStoredUser(user: AuthUser | null) {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  },

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const res = await apiClient.post<{ token: string; user: AuthUser }>('/api/v1/auth/login', {
      email,
      password
    });
    apiClient.setToken(res.data.token);
    this.setStoredUser(res.data.user);
    return res.data;
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // Even if network fails or token was already revoked, clear client state
    } finally {
      apiClient.setToken(null);
      this.setStoredUser(null);
    }
  },

  async getMe(): Promise<AuthUser> {
    const res = await apiClient.get<{ user: AuthUser }>('/api/v1/auth/me');
    this.setStoredUser(res.data.user);
    return res.data.user;
  }
};
