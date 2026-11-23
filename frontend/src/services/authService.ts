/**
 * Authentication Service (Frontend)
 * Coordinates with backend /api/v1/auth endpoints using HttpOnly cookie authentication.
 */

import { apiClient } from './apiClient';
import { sessionSync } from './sessionSync';
import { UserRole, UserStatus } from '../types/designSystem';
import { DepartmentItem, StudentRegistrationPayload } from '../types/student';

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

let sessionEpoch = 0;

export const authService = {
  getSessionEpoch(): number {
    return sessionEpoch;
  },

  incrementSessionEpoch(): number {
    return ++sessionEpoch;
  },

  isStaleEpoch(epoch: number): boolean {
    return epoch !== sessionEpoch;
  },

  getStoredUser(): AuthUser | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  setStoredUser(user: AuthUser | null) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('ts_auth_token'); // Ensure legacy token key is wiped
      }
    } catch {
      // Safe storage handling
    }
  },

  async login(email: string, password: string): Promise<{ user: AuthUser; token?: string }> {
    const res = await apiClient.post<{ user: AuthUser; token?: string }>(
      '/api/v1/auth/login',
      { email, password },
      { headers: { 'X-Session-Mode': 'cookie-only' } }
    );
    sessionEpoch++;
    this.setStoredUser(res.data.user);
    apiClient.resetUnauthorizedGuard();
    return res.data;
  },

  async logout(): Promise<void> {
    sessionEpoch++;
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // Even if network fails or token was already revoked, clear client state
    } finally {
      this.setStoredUser(null);
      sessionSync.broadcastLogout();
    }
  },

  handleRemoteLogout(): void {
    sessionEpoch++;
    this.setStoredUser(null);
  },

  async getMe(): Promise<AuthUser> {
    const requestEpoch = sessionEpoch;
    // Verified backend contract: GET /api/v1/auth/me returns { success: true, data: user }
    const res = await apiClient.get<AuthUser>('/api/v1/auth/me');
    if (requestEpoch !== sessionEpoch) {
      const err = new Error('STALE_SESSION_RESPONSE');
      (err as any).isStale = true;
      throw err;
    }
    this.setStoredUser(res.data);
    apiClient.resetUnauthorizedGuard();
    return res.data;
  },

  async getDepartments(): Promise<DepartmentItem[]> {
    const res = await apiClient.get<{ total: number; departments: DepartmentItem[] }>('/api/v1/departments');
    return res.data?.departments || [];
  },

  async registerStudent(payload: StudentRegistrationPayload): Promise<{ user: AuthUser; profile?: any; token?: string }> {
    const res = await apiClient.post<{ user: AuthUser; profile?: any; token?: string }>(
      '/api/v1/auth/register',
      payload,
      { headers: { 'X-Session-Mode': 'cookie-only' } }
    );
    sessionEpoch++;
    this.setStoredUser(res.data.user);
    apiClient.resetUnauthorizedGuard();
    return res.data;
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/forgot-password', { email });
    return res.data;
  },

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/reset-password', { token, newPassword });
    return res.data;
  },

  async verifyEmail(token: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/verify-email', { token });
    return res.data;
  },

  async resendVerification(email: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/resend-verification', { email });
    return res.data;
  },

  async onboardTeacher(token: string, password: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/onboard-teacher', { token, password });
    return res.data;
  }
};
