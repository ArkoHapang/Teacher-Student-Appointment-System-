import React from 'react';
import { UserRole, NavItem, RoleNavigation } from '../../types/designSystem';
import {
  CalendarIcon,
  ClockIcon,
  UserIcon,
  UsersIcon,
  ShieldIcon,
  FileTextIcon,
  LogOutIcon,
  MenuIcon,
  XIcon,
  ActivityIcon
} from '../Icons/Icons';
import { Badge } from '../Badge/Badge';
import { Button } from '../Button/Button';
import './Navigation.css';

export const ROLE_NAVIGATION_CONFIGS: Record<UserRole, RoleNavigation> = {
  STUDENT: {
    role: 'STUDENT',
    roleLabel: 'Student Portal',
    roleDescription: 'Manage your academic consultations and requests',
    items: [
      {
        id: 'student-appointments',
        label: 'My Appointments',
        href: '#appointments',
        icon: 'calendar'
      },
      {
        id: 'student-teachers',
        label: 'Faculty Directory',
        href: '#teachers',
        icon: 'users'
      },
      {
        id: 'student-notifications',
        label: 'Notifications',
        href: '#notifications',
        icon: 'activity'
      },
      {
        id: 'student-profile',
        label: 'Student Profile',
        href: '#profile',
        icon: 'user'
      }
    ]
  },
  TEACHER: {
    role: 'TEACHER',
    roleLabel: 'Faculty Portal',
    roleDescription: 'Review student appointment requests and office hour slots',
    items: [
      {
        id: 'teacher-pending',
        label: 'Appointment Requests',
        href: '#teacher-requests',
        icon: 'calendar'
      },
      {
        id: 'teacher-schedule',
        label: 'Confirmed Schedule',
        href: '#teacher-schedule',
        icon: 'clock'
      },
      {
        id: 'teacher-availability',
        label: 'Office Hours & Slots',
        href: '#teacher-availability',
        icon: 'clock'
      },
      {
        id: 'teacher-notifications',
        label: 'Notifications',
        href: '#teacher-notifications',
        icon: 'activity'
      },
      {
        id: 'teacher-profile',
        label: 'Faculty Profile',
        href: '#teacher-profile',
        icon: 'user'
      }
    ]
  },
  ADMIN: {
    role: 'ADMIN',
    roleLabel: 'Administration',
    roleDescription: 'System-wide monitoring, teacher verification, and audit logs',
    items: [
      {
        id: 'admin-appointments',
        label: 'Appointment Monitor',
        href: '#admin-appointments',
        icon: 'calendar'
      },
      {
        id: 'admin-teachers',
        label: 'Teacher Management',
        href: '#admin-teachers',
        icon: 'users',
        badge: 'New'
      },
      {
        id: 'admin-users',
        label: 'User Accounts',
        href: '#admin-users',
        icon: 'user'
      },
      {
        id: 'admin-audit',
        label: 'Audit Logs',
        href: '#admin-audit',
        icon: 'file-text'
      },
      {
        id: 'admin-health',
        label: 'System Status',
        href: '#admin-health',
        icon: 'activity'
      }
    ]
  }
};

export const getNavIcon = (iconName: NavItem['icon']) => {
  switch (iconName) {
    case 'calendar':
      return <CalendarIcon size={18} />;
    case 'clock':
      return <ClockIcon size={18} />;
    case 'user':
      return <UserIcon size={18} />;
    case 'users':
      return <UsersIcon size={18} />;
    case 'shield':
      return <ShieldIcon size={18} />;
    case 'file-text':
      return <FileTextIcon size={18} />;
    case 'activity':
      return <ActivityIcon size={18} />;
    default:
      return <CalendarIcon size={18} />;
  }
};

export interface HeaderProps {
  currentRole: UserRole;
  userName?: string;
  userEmail?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  onOpenMobileMenu?: () => void;
  onBrandClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  userName = 'User',
  userEmail = '',
  theme,
  onToggleTheme,
  onLogout,
  onOpenMobileMenu,
  onBrandClick
}) => {
  return (
    <header className="ui-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {onOpenMobileMenu && (
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm ui-header__menu-toggle"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            style={{ color: '#FFFFFF', padding: '6px' }}
          >
            <MenuIcon size={22} />
          </button>
        )}
        <a
          href="#home"
          className="ui-header__brand"
          onClick={e => {
            if (onBrandClick) {
              e.preventDefault();
              onBrandClick();
            }
          }}
          aria-label="Return to system home"
        >
          <div className="ui-header__brand-mark" aria-hidden="true">
            U
          </div>
          <div>
            <div className="ui-header__title">
              <span>University Appointment System</span>
            </div>
            <div className="ui-header__subtitle">Academic Scheduling Portal</div>
          </div>
        </a>
      </div>

      <div className="ui-header__controls">
        <Badge variant={currentRole === 'ADMIN' ? 'suspended' : currentRole === 'TEACHER' ? 'info' : 'active'}>
          {currentRole}
        </Badge>

        <div className="ui-header__user-info">
          <div className="ui-header__user-name">{userName}</div>
          <div className="ui-header__user-role">{userEmail}</div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          {theme === 'light' ? 'Dark' : 'Light'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          aria-label="Log out of application"
          style={{ color: '#FFFFFF' }}
          leadingIcon={<LogOutIcon size={16} />}
        >
          Log Out
        </Button>
      </div>
    </header>
  );
};

export interface RoleNavProps {
  currentRole: UserRole;
  activeItemId: string;
  onSelectItem: (itemId: string) => void;
  unreadNotificationsCount?: number;
}

export const RoleNav: React.FC<RoleNavProps> = ({
  currentRole,
  activeItemId,
  onSelectItem,
  unreadNotificationsCount
}) => {
  const config = ROLE_NAVIGATION_CONFIGS[currentRole];

  return (
    <nav className="ui-role-nav" aria-label={`${config.roleLabel} Navigation`}>
      <ul className="ui-role-nav__list">
        {config.items.map(item => {
          const isActive = item.id === activeItemId;
          const isNotificationItem = item.id === 'student-notifications' || item.id === 'teacher-notifications';
          const dynamicBadge = isNotificationItem
            ? unreadNotificationsCount && unreadNotificationsCount > 0
              ? unreadNotificationsCount > 99
                ? '99+'
                : unreadNotificationsCount
              : undefined
            : item.badge;

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`ui-role-nav__item ${isActive ? 'ui-role-nav__item--active' : ''}`}
                onClick={() => onSelectItem(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                {getNavIcon(item.icon)}
                <span>{item.label}</span>
                {dynamicBadge !== undefined && (
                  <span className="ui-role-nav__badge">{dynamicBadge}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  activeItemId: string;
  onSelectItem: (itemId: string) => void;
  unreadNotificationsCount?: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  isOpen,
  onClose,
  currentRole,
  activeItemId,
  onSelectItem,
  unreadNotificationsCount
}) => {
  // Listen for Escape key to close mobile drawer (Issue #45)
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const config = ROLE_NAVIGATION_CONFIGS[currentRole];

  return (
    <div className="ui-mobile-nav-backdrop" onClick={onClose} aria-hidden="true">
      <div
        className="ui-mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile Navigation"
        onClick={e => e.stopPropagation()}
      >
        <div className="ui-mobile-nav__header">
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{config.roleLabel}</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
              {config.roleDescription}
            </div>
          </div>
          <button
            type="button"
            className="ui-dialog__close"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <XIcon size={20} />
          </button>
        </div>

        <ul className="ui-mobile-nav__list">
          {config.items.map(item => {
            const isActive = item.id === activeItemId;
            const isNotificationItem = item.id === 'student-notifications' || item.id === 'teacher-notifications';
            const dynamicBadge = isNotificationItem
              ? unreadNotificationsCount && unreadNotificationsCount > 0
                ? unreadNotificationsCount > 99
                  ? '99+'
                  : unreadNotificationsCount
                : undefined
              : item.badge;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`ui-mobile-nav__link ${isActive ? 'ui-mobile-nav__link--active' : ''}`}
                  onClick={() => {
                    onSelectItem(item.id);
                    onClose();
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  style={{ width: '100%', border: 'none', background: 'none' }}
                >
                  {getNavIcon(item.icon)}
                  <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                  {dynamicBadge !== undefined && (
                    <span className="ui-role-nav__badge">{dynamicBadge}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
