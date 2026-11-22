/**
 * Student Notifications View
 * Displays institutional notifications, appointment updates, and system reminders.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { studentService } from '../../services/studentService';
import { StudentNotificationItem } from '../../types/student';
import { notificationStreamService, RealtimeNotificationPayload } from '../../services/notificationStreamService';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import { BadgeVariant } from '../../types/designSystem';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import { CalendarIcon, InfoIcon, CheckIcon } from '../../components/Icons/Icons';

interface StudentNotificationsViewProps {
  userId: number;
  onNavigateToAppointments?: () => void;
  onUnreadCountChange?: (count: number, readNotificationId?: number) => void;
}

export const StudentNotificationsView: React.FC<StudentNotificationsViewProps> = ({
  userId,
  onNavigateToAppointments,
  onUnreadCountChange
}) => {
  const [notifications, setNotifications] = useState<StudentNotificationItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<Set<number>>(new Set());
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await studentService.getNotifications(userId);
      setNotifications(data);
      if (onUnreadCountChange) {
        onUnreadCountChange(data.filter(n => !n.isRead).length);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve notification records.');
    } finally {
      setIsLoading(false);
    }
  }, [userId, onUnreadCountChange]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Subscribe to shared real-time SSE stream
  useEffect(() => {
    const unsubscribe = notificationStreamService.onNotification((incoming: RealtimeNotificationPayload) => {
      if (incoming.recipientId !== userId) return;

      setNotifications(prev => {
        if (prev.some(n => n.id === incoming.id)) {
          return prev;
        }
        const item: StudentNotificationItem = {
          id: incoming.id,
          recipientId: incoming.recipientId,
          appointmentId: incoming.appointmentId ?? undefined,
          title: incoming.title,
          message: incoming.message,
          type: incoming.type,
          isRead: incoming.isRead,
          createdAt: incoming.createdAt || new Date().toISOString()
        };
        const updated = [item, ...prev];
        if (onUnreadCountChange) {
          onUnreadCountChange(updated.filter(n => !n.isRead).length);
        }
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [userId, onUnreadCountChange]);

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') {
      return !n.isRead;
    }
    return true;
  });

  const getNotificationBadgeVariant = (type: string): BadgeVariant => {
    switch (type) {
      case 'STATUS_UPDATE':
      case 'BOOKING_CONFIRMED':
        return 'approved';
      case 'BOOKING_REQUEST':
      case 'RESCHEDULE_REQUEST':
        return 'pending';
      case 'SYSTEM_ALERT':
        return 'rejected';
      case 'REMINDER':
      case 'NOTE_ADDED':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatNotificationType = (type: string): string => {
    return type
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleMarkAsRead = async (notificationId: number) => {
    if (pendingActionIds.has(notificationId)) return;
    setPendingActionIds(prev => new Set(prev).add(notificationId));
    setErrorMessage(null);
    try {
      await studentService.markNotificationAsRead(userId, notificationId);
      setNotifications(prev => {
        const updated = prev.map(n => (n.id === notificationId ? { ...n, isRead: 1 } : n));
        if (onUnreadCountChange) {
          onUnreadCountChange(updated.filter(n => !n.isRead).length, notificationId);
        }
        return updated;
      });
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to mark notification as read.');
    } finally {
      setPendingActionIds(prev => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }
  };

  const handleMarkAllAsRead = async () => {
    if (isMarkingAll || unreadCount === 0) return;
    setIsMarkingAll(true);
    setErrorMessage(null);
    try {
      await studentService.markAllNotificationsAsRead(userId);
      setNotifications(prev => {
        const updated = prev.map(n => (n.isRead ? n : { ...n, isRead: 1 }));
        if (onUnreadCountChange) {
          onUnreadCountChange(0);
        }
        return updated;
      });
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to mark all notifications as read.');
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">
            Notifications & Messages {unreadCount > 0 && <span style={{ fontSize: 'var(--font-size-sm)', verticalAlign: 'middle', marginLeft: '8px' }}><Badge variant="pending">{unreadCount} New</Badge></span>}
          </h1>
          <p className="page-header__description">
            Stay informed on appointment confirmations, schedule changes, and departmental announcements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              leadingIcon={<CheckIcon size={14} />}
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAll || isLoading}
              isLoading={isMarkingAll}
            >
              Mark All as Read
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={loadNotifications}
            disabled={isLoading || isMarkingAll}
          >
            Refresh
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--color-border-subtle)',
          marginBottom: '20px',
          paddingBottom: '8px'
        }}
      >
        <Button
          variant={filter === 'all' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All Notifications ({notifications.length})
        </Button>
        <Button
          variant={filter === 'unread' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setFilter('unread')}
        >
          Unread Only ({unreadCount})
        </Button>
      </div>

      {/* Notification List */}
      {isLoading ? (
        <LoadingState message="Fetching your latest notifications and alerts..." />
      ) : errorMessage && notifications.length === 0 ? (
        <ErrorState
          title="Notifications Unavailable"
          message={errorMessage}
          onRetry={loadNotifications}
        />
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'No Unread Notifications' : 'No Notifications'}
          description={
            filter === 'unread'
              ? 'You have reviewed all your academic alerts and messages.'
              : 'You do not have any notifications yet. Alerts for consultation confirmations and updates will appear here.'
          }
          icon={<InfoIcon size={24} />}
          actionLabel={filter === 'unread' ? 'View All Notifications' : undefined}
          onAction={filter === 'unread' ? () => setFilter('all') : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredNotifications.map(item => (
            <div
              key={item.id}
              className="surface-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderLeft: item.isRead ? '1px solid var(--color-border-subtle)' : '4px solid var(--color-primary-600)',
                backgroundColor: item.isRead ? 'var(--color-bg-surface)' : 'var(--color-bg-surface-subtle)',
                transition: 'border-color 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {!item.isRead && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-primary-600)',
                        display: 'inline-block'
                      }}
                      title="Unread notification"
                      aria-label="Unread"
                    />
                  )}
                  <h2 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>
                    {item.title}
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge variant={getNotificationBadgeVariant(item.type)}>
                    {formatNotificationType(item.type)}
                  </Badge>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {new Date(item.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)', margin: 0, lineHeight: 1.5 }}>
                {item.message}
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                {item.appointmentId && onNavigateToAppointments && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<CalendarIcon size={14} />}
                    onClick={onNavigateToAppointments}
                  >
                    View Related Appointment
                  </Button>
                )}
                {!item.isRead && (
                  <Button
                    variant="outline"
                    size="sm"
                    leadingIcon={<CheckIcon size={14} />}
                    onClick={() => handleMarkAsRead(item.id)}
                    disabled={pendingActionIds.has(item.id) || isMarkingAll}
                    isLoading={pendingActionIds.has(item.id)}
                  >
                    Mark as read
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
