/**
 * Teacher Service (Frontend)
 * Coordinates with backend /api/v1/users, /api/v1/teachers, /api/v1/appointments, and notifications.
 * Provides defensive data normalization across camelCase and snake_case backend payloads.
 */

import { apiClient } from './apiClient';
import {
  TeacherUser,
  TeacherSlotItem,
  TeacherAppointmentItem,
  TeacherNotificationItem
} from '../types/teacher';
import { AppointmentHistoryRecord } from '../types/admin';

// Normalization Helpers
function normalizeTeacherUser(raw: any): TeacherUser {
  return {
    ...raw,
    id: raw.id,
    email: raw.email,
    firstName: raw.firstName ?? raw.first_name,
    lastName: raw.lastName ?? raw.last_name,
    role: raw.role ?? 'TEACHER',
    status: raw.status,
    createdAt: raw.createdAt ?? raw.created_at,
    profile: raw.profile
      ? {
          ...raw.profile,
          id: raw.profile.id,
          userId: raw.profile.userId ?? raw.profile.user_id,
          departmentId: raw.profile.departmentId ?? raw.profile.department_id,
          departmentName: raw.profile.departmentName ?? raw.profile.department_name,
          departmentCode: raw.profile.departmentCode ?? raw.profile.department_code,
          designation: raw.profile.designation,
          officeRoom: raw.profile.officeRoom ?? raw.profile.office_room,
          bio: raw.profile.bio,
          isVerified: raw.profile.isVerified ?? raw.profile.is_verified
        }
      : undefined
  };
}

function normalizeSlot(raw: any): TeacherSlotItem {
  return {
    ...raw,
    id: raw.id,
    teacherId: raw.teacherId ?? raw.teacher_id,
    slotDate: raw.slotDate ?? raw.slot_date,
    startTime: raw.startTime ?? raw.start_time,
    endTime: raw.endTime ?? raw.end_time,
    startTimestamp: raw.startTimestamp ?? raw.start_timestamp,
    endTimestamp: raw.endTimestamp ?? raw.end_timestamp,
    isBooked: raw.isBooked ?? raw.is_booked ?? 0,
    isActive: raw.isActive ?? raw.is_active ?? 1,
    designation: raw.designation,
    officeRoom: raw.officeRoom ?? raw.office_room
  };
}

function normalizeAppointment(raw: any): TeacherAppointmentItem {
  return {
    ...raw,
    id: raw.id,
    studentId: raw.studentId ?? raw.student_id,
    teacherId: raw.teacherId ?? raw.teacher_id,
    slotId: raw.slotId ?? raw.slot_id,
    title: raw.title,
    purpose: raw.purpose,
    status: raw.status,
    cancellationReason: raw.cancellationReason ?? raw.cancellation_reason,
    cancelledBy: raw.cancelledBy ?? raw.cancelled_by,
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at,
    studentFirstName: raw.studentFirstName ?? raw.student_first_name,
    studentLastName: raw.studentLastName ?? raw.student_last_name,
    studentEmail: raw.studentEmail ?? raw.student_email,
    studentIdNumber: raw.studentIdNumber ?? raw.student_id_number,
    departmentName: raw.departmentName ?? raw.department_name,
    departmentCode: raw.departmentCode ?? raw.department_code,
    teacherFirstName: raw.teacherFirstName ?? raw.teacher_first_name,
    teacherLastName: raw.teacherLastName ?? raw.teacher_last_name,
    teacherEmail: raw.teacherEmail ?? raw.teacher_email,
    officeRoom: raw.officeRoom ?? raw.office_room,
    designation: raw.designation,
    slotDate: raw.slotDate ?? raw.slot_date,
    startTime: raw.startTime ?? raw.start_time,
    endTime: raw.endTime ?? raw.end_time,
    startTimestamp: raw.startTimestamp ?? raw.start_timestamp,
    endTimestamp: raw.endTimestamp ?? raw.end_timestamp
  };
}

function normalizeNotification(raw: any): TeacherNotificationItem {
  return {
    ...raw,
    id: raw.id,
    recipientId: raw.recipientId ?? raw.recipient_id,
    appointmentId: raw.appointmentId ?? raw.appointment_id,
    title: raw.title,
    message: raw.message,
    type: raw.type,
    isRead: raw.isRead ?? raw.is_read ?? 0,
    createdAt: raw.createdAt ?? raw.created_at
  };
}

function normalizeHistory(raw: any): AppointmentHistoryRecord {
  return {
    ...raw,
    id: raw.id,
    appointmentId: raw.appointmentId ?? raw.appointment_id,
    previousStatus: raw.previousStatus ?? raw.previous_status,
    newStatus: raw.newStatus ?? raw.new_status,
    changedBy: raw.changedBy ?? raw.changed_by,
    notes: raw.notes,
    createdAt: raw.createdAt ?? raw.created_at
  };
}

export const teacherService = {
  // -------------------------------------------------------------
  // Profile Workflows
  // -------------------------------------------------------------
  async getProfile(userId: number): Promise<TeacherUser> {
    const res = await apiClient.get<any>(`/api/v1/users/${userId}`);
    return normalizeTeacherUser(res.data);
  },

  async updateProfile(
    userId: number,
    teacherProfileId: number,
    data: { firstName: string; lastName: string; designation: string; officeRoom: string; bio?: string }
  ): Promise<{ firstName: string; lastName: string; designation: string; officeRoom: string; bio?: string }> {
    // 1. Update personal name on user record
    const userRes = await apiClient.patch<any>(`/api/v1/users/${userId}`, {
      firstName: data.firstName,
      lastName: data.lastName
    });

    // 2. Update designation, office room, bio on teacher profile
    const teacherRes = await apiClient.patch<any>(`/api/v1/teachers/${teacherProfileId}`, {
      designation: data.designation,
      officeRoom: data.officeRoom,
      bio: data.bio
    });

    return {
      firstName: userRes.data.firstName ?? userRes.data.first_name,
      lastName: userRes.data.lastName ?? userRes.data.last_name,
      designation: teacherRes.data.designation,
      officeRoom: teacherRes.data.officeRoom ?? teacherRes.data.office_room,
      bio: teacherRes.data.bio
    };
  },

  // -------------------------------------------------------------
  // Availability & Office Hour Slots
  // -------------------------------------------------------------
  async getSlots(teacherId: number, options?: { all?: boolean }): Promise<TeacherSlotItem[]> {
    const res = await apiClient.get<{ total: number; slots: any[] }>(
      `/api/v1/teachers/${teacherId}/slots`,
      options?.all ? { all: 'true' } : undefined
    );
    return (res.data.slots || []).map(normalizeSlot);
  },

  async createSlot(
    teacherId: number,
    data: { slotDate: string; startTime: string; endTime: string }
  ): Promise<TeacherSlotItem> {
    const res = await apiClient.post<any>(`/api/v1/teachers/${teacherId}/slots`, data);
    return normalizeSlot(res.data);
  },

  async updateSlot(
    teacherId: number,
    slotId: number,
    isActive: boolean
  ): Promise<{ id: number; isActive: number }> {
    const res = await apiClient.patch<any>(`/api/v1/teachers/${teacherId}/slots/${slotId}`, {
      isActive
    });
    return res.data;
  },

  async deleteSlot(teacherId: number, slotId: number): Promise<{ message: string }> {
    const res = await apiClient.delete<{ message: string }>(`/api/v1/teachers/${teacherId}/slots/${slotId}`);
    return res.data;
  },

  // -------------------------------------------------------------
  // Appointments Management & Decisions
  // -------------------------------------------------------------
  async getAppointments(status?: string): Promise<{ total: number; appointments: TeacherAppointmentItem[] }> {
    const res = await apiClient.get<{ total: number; appointments: any[] }>(
      '/api/v1/appointments',
      status ? { status } : undefined
    );
    return {
      total: res.data.total,
      appointments: (res.data.appointments || []).map(normalizeAppointment)
    };
  },

  async getAppointment(id: number): Promise<TeacherAppointmentItem> {
    const res = await apiClient.get<any>(`/api/v1/appointments/${id}`);
    return normalizeAppointment(res.data);
  },

  async approveAppointment(id: number, notes?: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>(`/api/v1/appointments/${id}/approve`, {
      notes: notes || undefined
    });
    return res.data;
  },

  async rejectAppointment(id: number, reason: string, notes?: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>(`/api/v1/appointments/${id}/reject`, {
      reason,
      notes: notes || undefined
    });
    return res.data;
  },

  async completeAppointment(id: number): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>(`/api/v1/appointments/${id}/complete`);
    return res.data;
  },

  async cancelAppointment(id: number, cancellationReason: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>(`/api/v1/appointments/${id}/cancel`, {
      cancellationReason
    });
    return res.data;
  },

  async rescheduleAppointment(id: number, proposedSlotId: number, reason: string): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>(`/api/v1/appointments/${id}/reschedule`, {
      proposedSlotId,
      reason
    });
    return res.data;
  },

  async getAppointmentHistory(id: number): Promise<AppointmentHistoryRecord[]> {
    const res = await apiClient.get<{ appointmentId: number; totalEntries: number; history: any[] }>(
      `/api/v1/appointments/${id}/history`
    );
    return (res.data.history || []).map(normalizeHistory);
  },

  // -------------------------------------------------------------
  // Notifications & Alerts
  // -------------------------------------------------------------
  async getNotifications(userId: number): Promise<TeacherNotificationItem[]> {
    const res = await apiClient.get<{ total: number; notifications: any[] }>(
      `/api/v1/users/${userId}/notifications`
    );
    return (res.data.notifications || []).map(normalizeNotification);
  }
};
