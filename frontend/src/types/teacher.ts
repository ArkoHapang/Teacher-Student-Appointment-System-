/**
 * Teacher Domain Type Definitions
 * Maps to backend schemas for faculty profile, availability slots, appointment requests, and schedule.
 */

import { AppointmentStatus, UserStatus } from './designSystem';

export interface TeacherProfileData {
  id: number;
  userId: number;
  departmentId: number;
  departmentName: string;
  departmentCode: string;
  designation: string;
  officeRoom: string;
  bio?: string;
  isVerified: number | boolean;
}

export interface TeacherUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'TEACHER';
  status: UserStatus;
  createdAt: string;
  profile?: TeacherProfileData;
}

export interface TeacherSlotItem {
  id: number;
  teacherId: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  startTimestamp: string;
  endTimestamp: string;
  isBooked: number | boolean;
  isActive: number | boolean;
  designation?: string;
  officeRoom?: string;
}

export interface TeacherAppointmentItem {
  id: number;
  studentId: number;
  teacherId: number;
  slotId: number;
  title: string;
  purpose: string;
  status: AppointmentStatus;
  cancellationReason?: string;
  cancelledBy?: number;
  createdAt: string;
  updatedAt: string;
  studentFirstName: string;
  studentLastName: string;
  studentEmail: string;
  studentIdNumber: string;
  departmentName?: string;
  departmentCode?: string;
  teacherFirstName: string;
  teacherLastName: string;
  teacherEmail: string;
  officeRoom: string;
  designation: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  startTimestamp: string;
  endTimestamp: string;
}

export interface TeacherNotificationItem {
  id: number;
  recipientId: number;
  appointmentId?: number;
  title: string;
  message: string;
  type: string;
  isRead: number;
  createdAt: string;
}
