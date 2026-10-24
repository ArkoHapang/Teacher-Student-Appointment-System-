/**
 * Student Service (Frontend)
 * Coordinates with backend /api/v1/users, /api/v1/teachers, /api/v1/appointments, and notifications.
 * Provides defensive data normalization across camelCase and snake_case backend payloads.
 */

import { apiClient } from './apiClient';
import {
  StudentUser,
  TeacherDirectoryItem,
  TeacherAvailabilitySlot,
  StudentAppointmentItem,
  StudentNotificationItem
} from '../types/student';
import { AppointmentHistoryRecord } from '../types/admin';

// Normalization Helpers
function normalizeStudentUser(raw: any): StudentUser {
  return {
    ...raw,
    id: raw.id,
    email: raw.email,
    firstName: raw.firstName ?? raw.first_name,
    lastName: raw.lastName ?? raw.last_name,
    role: raw.role ?? 'STUDENT',
    status: raw.status,
    createdAt: raw.createdAt ?? raw.created_at,
    profile: raw.profile
      ? {
          ...raw.profile,
          id: raw.profile.id,
          userId: raw.profile.userId ?? raw.profile.user_id,
          studentIdNumber: raw.profile.studentIdNumber ?? raw.profile.student_id_number,
          departmentId: raw.profile.departmentId ?? raw.profile.department_id,
          departmentName: raw.profile.departmentName ?? raw.profile.department_name,
          departmentCode: raw.profile.departmentCode ?? raw.profile.department_code,
          batch: raw.profile.batch,
          phoneNumber: raw.profile.phoneNumber ?? raw.profile.phone_number
        }
      : undefined
  };
}

function normalizeTeacher(raw: any): TeacherDirectoryItem {
  return {
    ...raw,
    teacherProfileId: raw.teacherProfileId ?? raw.teacher_profile_id ?? raw.id,
    userId: raw.userId ?? raw.user_id,
    firstName: raw.firstName ?? raw.first_name,
    lastName: raw.lastName ?? raw.last_name,
    email: raw.email,
    designation: raw.designation,
    officeRoom: raw.officeRoom ?? raw.office_room,
    bio: raw.bio,
    isVerified: Boolean(raw.isVerified ?? raw.is_verified),
    departmentCode: raw.departmentCode ?? raw.department_code,
    departmentName: raw.departmentName ?? raw.department_name
  };
}

function normalizeSlot(raw: any): TeacherAvailabilitySlot {
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

function normalizeAppointment(raw: any): StudentAppointmentItem {
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

function normalizeNotification(raw: any): StudentNotificationItem {
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

export const studentService = {
  // -------------------------------------------------------------
  // Profile Workflows
  // -------------------------------------------------------------
  async getProfile(userId: number): Promise<StudentUser> {
    const res = await apiClient.get<any>(`/api/v1/users/${userId}`);
    return normalizeStudentUser(res.data);
  },

  async updateProfile(userId: number, data: { firstName: string; lastName: string }): Promise<{ firstName: string; lastName: string }> {
    const res = await apiClient.patch<any>(
      `/api/v1/users/${userId}`,
      data
    );
    return {
      firstName: res.data.firstName ?? res.data.first_name,
      lastName: res.data.lastName ?? res.data.last_name
    };
  },

  // -------------------------------------------------------------
  // Teacher Directory & Availability
  // -------------------------------------------------------------
  async getTeachers(): Promise<TeacherDirectoryItem[]> {
    const res = await apiClient.get<{ total: number; teachers: any[] }>('/api/v1/teachers');
    return (res.data.teachers || []).map(normalizeTeacher);
  },

  async getTeacher(id: number): Promise<TeacherDirectoryItem> {
    const res = await apiClient.get<any>(`/api/v1/teachers/${id}`);
    return normalizeTeacher(res.data);
  },

  async getTeacherSlots(teacherId: number): Promise<TeacherAvailabilitySlot[]> {
    const res = await apiClient.get<{ total: number; slots: any[] }>(`/api/v1/teachers/${teacherId}/slots`);
    return (res.data.slots || []).map(normalizeSlot);
  },

  // -------------------------------------------------------------
  // Appointment Requests & Lifecycle
  // -------------------------------------------------------------
  async requestAppointment(data: { slotId: number; title: string; purpose: string }): Promise<StudentAppointmentItem> {
    const res = await apiClient.post<any>('/api/v1/appointments', data);
    return normalizeAppointment(res.data);
  },

  async getAppointments(status?: string): Promise<{ total: number; appointments: StudentAppointmentItem[] }> {
    const res = await apiClient.get<{ total: number; appointments: any[] }>(
      '/api/v1/appointments',
      status ? { status } : undefined
    );
    return {
      total: res.data.total,
      appointments: (res.data.appointments || []).map(normalizeAppointment)
    };
  },

  async getAppointment(id: number): Promise<StudentAppointmentItem> {
    const res = await apiClient.get<any>(`/api/v1/appointments/${id}`);
    return normalizeAppointment(res.data);
  },

  async getAppointmentHistory(id: number): Promise<AppointmentHistoryRecord[]> {
    const res = await apiClient.get<{ appointmentId: number; totalEntries: number; history: any[] }>(
      `/api/v1/appointments/${id}/history`
    );
    return (res.data.history || []).map(normalizeHistory);
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

  // -------------------------------------------------------------
  // Notifications & Messages
  // -------------------------------------------------------------
  async getNotifications(userId: number): Promise<StudentNotificationItem[]> {
    const res = await apiClient.get<{ total: number; notifications: any[] }>(
      `/api/v1/users/${userId}/notifications`
    );
    return (res.data.notifications || []).map(normalizeNotification);
  }
};
