/**
 * Administrative Domain Type Definitions
 * Directly corresponds to backend API schemas (/api/v1/admin/* and /api/v1/auth/*).
 */

import { AppointmentStatus, UserRole, UserStatus } from './designSystem';

export interface AdminUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
}

export interface Department {
  id: number;
  code: string;
  name: string;
}

export interface TeacherMetricCounts {
  coursesCount: number;
  slotsCount: number;
  appointmentsCount: number;
  upcomingAppointmentsCount: number;
}

export interface TeacherStats {
  totalSlots: number;
  activeOpenSlots: number;
  totalAppointments: number;
  upcomingAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  rejectedAppointments: number;
}

export interface TeacherCourse {
  id: number;
  courseCode: string;
  courseTitle: string;
}

export interface TeacherRecord {
  id: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  department: Department;
  designation: string;
  officeRoom: string;
  bio?: string;
  isVerified: number | boolean;
  createdAt: string;
  updatedAt: string;
  metrics?: TeacherMetricCounts;
  stats?: TeacherStats;
  courses?: TeacherCourse[];
}

export interface CreateTeacherPayload {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  departmentId: number;
  designation: string;
  officeRoom: string;
  bio?: string;
  isVerified?: number;
  status?: string;
  courses?: Array<{ courseCode: string; courseTitle: string }>;
}

export interface UpdateTeacherPayload {
  email?: string;
  firstName?: string;
  lastName?: string;
  departmentId?: number;
  designation?: string;
  officeRoom?: string;
  bio?: string;
  isVerified?: number;
}

export interface StudentProfileBrief {
  profileId: number;
  userId: number;
  studentIdNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  department: Department;
}

export interface TeacherProfileBrief {
  profileId: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  designation: string;
  officeRoom: string;
  department: Department;
}

export interface SlotBrief {
  id: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  startTimestamp: string;
  endTimestamp: string;
}

export interface AppointmentRecord {
  id: number;
  title: string;
  purpose: string;
  status: AppointmentStatus;
  cancellationReason?: string;
  cancelledBy?: number;
  createdAt: string;
  updatedAt: string;
  student: StudentProfileBrief;
  teacher: TeacherProfileBrief;
  slot: SlotBrief;
}

export interface AppointmentSummary {
  total: number;
  byStatus: Record<string, number>;
  upcoming: number;
  today: number;
  completed: number;
}

export interface AppointmentHistoryRecord {
  id: number;
  appointmentId: number;
  previousStatus: string;
  newStatus: string;
  changedBy: number;
  changedByName?: string;
  changedByRole?: string;
  notes?: string;
  createdAt: string;
}

export interface ConflictingAppointment {
  appointmentId: number;
  title: string;
  status: string;
  slotId: number;
  start: string;
  end: string;
  studentName: string;
  studentEmail: string;
}

export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflictType?: string;
  code?: string;
  message: string;
  conflictingAppointments?: ConflictingAppointment[];
  requestedInterval?: {
    start: string;
    end: string;
  };
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown[];
}
