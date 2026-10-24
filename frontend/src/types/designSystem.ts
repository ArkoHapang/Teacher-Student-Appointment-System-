/**
 * University Appointment System - Design System Type Definitions
 * Maps exactly to backend database enums and frontend UI specifications.
 */

export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export type AppointmentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'RESCHEDULE_PENDING';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type BadgeVariant =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'completed'
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'info'
  | 'default';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: 'calendar' | 'clock' | 'user' | 'users' | 'shield' | 'file-text' | 'settings' | 'activity';
  badge?: string | number;
  description?: string;
}

export interface RoleNavigation {
  role: UserRole;
  roleLabel: string;
  roleDescription: string;
  items: NavItem[];
}

export interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

export interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
