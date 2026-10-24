/**
 * Student Domain Type Definitions
 * Maps to backend API schemas for student profile, appointment requests, teacher directory, and notifications.
 */

import { AppointmentStatus, UserStatus } from './designSystem';

export interface StudentProfileData {
  id: number;
  userId: number;
  studentIdNumber: string;
  departmentId: number;
  departmentName: string;
  departmentCode: string;
  batch?: string;
  phoneNumber?: string;
}

export interface StudentUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'STUDENT';
  status: UserStatus;
  createdAt: string;
  profile?: StudentProfileData;
}

export interface TeacherDirectoryItem {
  teacherProfileId: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  designation: string;
  officeRoom: string;
  bio?: string;
  isVerified: number | boolean;
  departmentCode: string;
  departmentName: string;
}

export interface TeacherAvailabilitySlot {
  id: number;
  teacherId: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  startTimestamp: string;
  endTimestamp: string;
  isBooked: number;
  isActive: number;
  designation?: string;
  officeRoom?: string;
}

export interface StudentAppointmentItem {
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

export interface StudentNotificationItem {
  id: number;
  recipientId: number;
  appointmentId?: number;
  title: string;
  message: string;
  type: string;
  isRead: number;
  createdAt: string;
}
