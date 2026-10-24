/**
 * Administrative Service
 * Wraps backend /api/v1/admin/* endpoints for teacher and appointment workflows.
 */

import { apiClient } from './apiClient';
import {
  TeacherRecord,
  AppointmentRecord,
  AppointmentSummary,
  AppointmentHistoryRecord,
  ConflictDetectionResult,
  Department,
  CreateTeacherPayload,
  UpdateTeacherPayload
} from '../types/admin';

export interface ListTeachersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  departmentId?: number;
  isVerified?: number | boolean;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface ListTeachersResponse {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  teachers: TeacherRecord[];
}

export interface ListAppointmentsParams {
  page?: number;
  limit?: number;
  status?: string;
  teacherId?: number;
  studentId?: number;
  departmentId?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface ListAppointmentsResponse {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appointments: AppointmentRecord[];
}

export interface ReschedulePayload {
  proposedSlotId: number;
  reason: string;
}

export interface ConflictCheckPayload {
  teacherId?: number;
  slotId?: number;
  startTimestamp?: string;
  endTimestamp?: string;
  excludeAppointmentId?: number;
}

export const adminService = {
  // -------------------------------------------------------------
  // Teachers Management (Issue #37)
  // -------------------------------------------------------------
  async listTeachers(params: ListTeachersParams = {}): Promise<ListTeachersResponse> {
    const res = await apiClient.get<ListTeachersResponse>('/api/v1/admin/teachers', params as Record<string, string | number | boolean | undefined>);
    return res.data;
  },

  async getTeacher(id: number): Promise<TeacherRecord> {
    const res = await apiClient.get<{ teacher: TeacherRecord }>(`/api/v1/admin/teachers/${id}`);
    return res.data.teacher;
  },

  async createTeacher(payload: CreateTeacherPayload): Promise<TeacherRecord> {
    const res = await apiClient.post<{ teacher: TeacherRecord }>('/api/v1/admin/teachers', payload);
    return res.data.teacher;
  },

  async updateTeacher(id: number, payload: UpdateTeacherPayload): Promise<TeacherRecord> {
    const res = await apiClient.patch<{ teacher: TeacherRecord }>(`/api/v1/admin/teachers/${id}`, payload);
    return res.data.teacher;
  },

  async updateTeacherStatus(
    id: number,
    payload: { status: string; reason?: string; notes?: string }
  ): Promise<{ teacherId: number; status: string; message: string }> {
    const res = await apiClient.patch<{ teacherId: number; status: string; message: string }>(
      `/api/v1/admin/teachers/${id}/status`,
      payload
    );
    return res.data;
  },

  async verifyTeacher(
    id: number,
    isVerified: boolean | number
  ): Promise<{ teacherProfileId: number; isVerified: number }> {
    const res = await apiClient.patch<{ teacherProfileId: number; isVerified: number }>(
      `/api/v1/admin/teachers/${id}/verify`,
      { isVerified: isVerified ? 1 : 0 }
    );
    return res.data;
  },

  // -------------------------------------------------------------
  // Appointment Monitoring & Summary (Issue #38)
  // -------------------------------------------------------------
  async getAppointmentSummary(): Promise<AppointmentSummary> {
    const res = await apiClient.get<{ summary: AppointmentSummary }>('/api/v1/admin/appointments/summary');
    return res.data.summary;
  },

  async listAppointments(params: ListAppointmentsParams = {}): Promise<ListAppointmentsResponse> {
    const res = await apiClient.get<ListAppointmentsResponse>('/api/v1/admin/appointments', params as Record<string, string | number | boolean | undefined>);
    return res.data;
  },

  async getAppointment(id: number): Promise<AppointmentRecord> {
    const res = await apiClient.get<{ appointment: AppointmentRecord }>(`/api/v1/admin/appointments/${id}`);
    return res.data.appointment;
  },

  async getAppointmentHistory(id: number): Promise<{ appointmentId: number; totalEntries: number; history: AppointmentHistoryRecord[] }> {
    const res = await apiClient.get<{ appointmentId: number; totalEntries: number; history: AppointmentHistoryRecord[] }>(
      `/api/v1/admin/appointments/${id}/history`
    );
    return res.data;
  },

  // -------------------------------------------------------------
  // Appointment Record Management (Issue #39)
  // -------------------------------------------------------------
  async updateAppointmentMetadata(
    id: number,
    payload: { title?: string; purpose?: string }
  ): Promise<AppointmentRecord> {
    const res = await apiClient.patch<{ appointment: AppointmentRecord }>(
      `/api/v1/admin/appointments/${id}`,
      payload
    );
    return res.data.appointment;
  },

  async updateAppointmentStatus(
    id: number,
    payload: { status: string; reason?: string; notes?: string }
  ): Promise<{ id: number; previousStatus: string; status: string; message: string }> {
    const res = await apiClient.patch<{ id: number; previousStatus: string; status: string; message: string }>(
      `/api/v1/admin/appointments/${id}/status`,
      payload
    );
    return res.data;
  },

  async approveAppointment(id: number, notes?: string): Promise<{ id: number; status: string; message: string }> {
    const res = await apiClient.post<{ id: number; status: string; message: string }>(
      `/api/v1/admin/appointments/${id}/approve`,
      { notes }
    );
    return res.data;
  },

  async rejectAppointment(id: number, payload: { reason?: string; notes?: string } = {}): Promise<{ id: number; status: string; message: string }> {
    const res = await apiClient.post<{ id: number; status: string; message: string }>(
      `/api/v1/admin/appointments/${id}/reject`,
      payload
    );
    return res.data;
  },

  async cancelAppointment(id: number, payload: { cancellationReason?: string; reason?: string; notes?: string } = {}): Promise<{ id: number; status: string; message: string }> {
    const res = await apiClient.post<{ id: number; status: string; message: string }>(
      `/api/v1/admin/appointments/${id}/cancel`,
      payload
    );
    return res.data;
  },

  async completeAppointment(id: number, payload: { notes?: string } = {}): Promise<{ id: number; status: string; message: string }> {
    const res = await apiClient.post<{ id: number; status: string; message: string }>(
      `/api/v1/admin/appointments/${id}/complete`,
      payload
    );
    return res.data;
  },

  async rescheduleAppointment(id: number, payload: ReschedulePayload): Promise<{ id: number; previousSlotId: number; newSlotId: number; message: string }> {
    const res = await apiClient.post<{ id: number; previousSlotId: number; newSlotId: number; message: string }>(
      `/api/v1/admin/appointments/${id}/reschedule`,
      payload
    );
    return res.data;
  },

  // -------------------------------------------------------------
  // Conflict Detection (Issue #40)
  // -------------------------------------------------------------
  async checkConflict(payload: ConflictCheckPayload): Promise<ConflictDetectionResult> {
    const res = await apiClient.post<ConflictDetectionResult>('/api/v1/appointments/check-conflict', payload);
    return res.data;
  },

  // -------------------------------------------------------------
  // Static Reference Data
  // -------------------------------------------------------------
  getDepartments(): Department[] {
    return [
      { id: 1, code: 'CSE', name: 'Computer Science and Engineering' },
      { id: 2, code: 'EEE', name: 'Electrical and Electronic Engineering' },
      { id: 3, code: 'BBA', name: 'School of Business Administration' },
      { id: 4, code: 'MATH', name: 'Department of Mathematics' },
      { id: 5, code: 'PHY', name: 'Department of Physics' }
    ];
  }
};
