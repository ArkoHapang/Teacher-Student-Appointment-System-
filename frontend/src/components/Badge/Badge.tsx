import React from 'react';
import { BadgeVariant, AppointmentStatus, UserStatus } from '../../types/designSystem';
import './Badge.css';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  pill?: boolean;
  withDot?: boolean;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  pill = false,
  withDot = true,
  className = '',
  children,
  ...rest
}) => {
  const classNames = [
    'ui-badge',
    `ui-badge--${variant}`,
    pill ? 'ui-badge--pill' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classNames} {...rest}>
      {withDot && <span className="ui-badge__dot" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
};

export const AppointmentStatusBadge: React.FC<{
  status: AppointmentStatus;
  pill?: boolean;
  className?: string;
}> = ({ status, pill = true, className }) => {
  const variantMap: Record<AppointmentStatus, BadgeVariant> = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    RESCHEDULE_PENDING: 'pending'
  };

  return (
    <Badge variant={variantMap[status] || 'default'} pill={pill} className={className}>
      {status}
    </Badge>
  );
};

export const UserStatusBadge: React.FC<{
  status: UserStatus;
  pill?: boolean;
  className?: string;
}> = ({ status, pill = true, className }) => {
  const variantMap: Record<UserStatus, BadgeVariant> = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended'
  };

  return (
    <Badge variant={variantMap[status] || 'default'} pill={pill} className={className}>
      {status}
    </Badge>
  );
};
