/**
 * Teacher–Student Appointment System
 *
 * Implements Faculty / Teacher Permitted Workflows:
 * 1. View and manage permitted profile fields (designation, office room, bio, names)
 * 2. Configure and update availability (office hour slots, interval overlap collision defense)
 * 3. View assigned appointment requests (pending faculty confirmation)
 * 4. Approve or reject requests according to business rules (guidance notes, mandatory reasons)
 * 5. View upcoming and historical appointments (confirmed schedule, completions)
 * 6. Cancel or reschedule appointments where permitted
 * 7. View relevant notifications and messages
 * 8. Logout and session invalidation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthUser, authService } from './services/authService';
import { apiClient } from './services/apiClient';
import { sessionSync } from './services/sessionSync';
import { Header, RoleNav, MobileNav } from './components/Navigation/Navigation';
import { Alert } from './components/Alert/Alert';
import { Button } from './components/Button/Button';
import { notificationStreamService, RealtimeNotificationPayload } from './services/notificationStreamService';
import { studentService } from './services/studentService';
import { teacherService } from './services/teacherService';

// Faculty / Teacher Views
import { TeacherLoginView } from './views/teacher/TeacherLoginView';
import { TeacherRequestsView } from './views/teacher/TeacherRequestsView';
import { TeacherScheduleView } from './views/teacher/TeacherScheduleView';
import { TeacherAvailabilityView } from './views/teacher/TeacherAvailabilityView';
import { TeacherNotificationsView } from './views/teacher/TeacherNotificationsView';
import { TeacherProfileView } from './views/teacher/TeacherProfileView';

// Existing Student & Admin Views (Preserved)
import { AdminLoginView } from './views/admin/AdminLoginView';
import { StudentLoginView } from './views/student/StudentLoginView';
import { StudentRegisterView } from './views/student/StudentRegisterView';
import { StudentAppointmentsView } from './views/student/StudentAppointmentsView';
import { FindTeachersView } from './views/student/FindTeachersView';
import { StudentNotificationsView } from './views/student/StudentNotificationsView';
import { StudentProfileView } from './views/student/StudentProfileView';
import { AppointmentMonitorView } from './views/admin/AppointmentMonitorView';
import { TeacherManagementView } from './views/admin/TeacherManagementView';
import { UserAccountsView } from './views/admin/UserAccountsView';
import { AuditLogsView } from './views/admin/AuditLogsView';
import { SystemStatusView } from './views/admin/SystemStatusView';

import './styles/global.css';

type TeacherTabId =
  | 'teacher-pending'
  | 'teacher-schedule'
  | 'teacher-availability'
  | 'teacher-notifications'
  | 'teacher-profile';

type StudentTabId =
  | 'student-appointments'
  | 'student-teachers'
  | 'student-notifications'
  | 'student-profile';

type AdminTabId =
  | 'admin-appointments'
  | 'admin-teachers'
  | 'admin-users'
  | 'admin-audit'
  | 'admin-health';

export const App: React.FC = () => {
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => authService.getStoredUser());
  const [loginRole, setLoginRole] = useState<'TEACHER' | 'STUDENT' | 'ADMIN'>('TEACHER');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Navigation tab states
  const [teacherTab, setTeacherTab] = useState<TeacherTabId>('teacher-pending');
  const [studentTab, setStudentTab] = useState<StudentTabId>('student-appointments');
  const [adminTab, setAdminTab] = useState<AdminTabId>('admin-appointments');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [studentAuthMode, setStudentAuthMode] = useState<'login' | 'register'>('login');
  const [registeredNotice, setRegisteredNotice] = useState<string | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const accountedUnreadIdsRef = useRef<Set<number>>(new Set());
  const knownReadIdsRef = useRef<Set<number>>(new Set());

  // Reconcile unread notification count and track read/unread IDs across views
  const handleUnreadCountChange = useCallback((newCount: number, readNotificationId?: number) => {
    const safeCount = Math.max(0, newCount);
    if (readNotificationId) {
      knownReadIdsRef.current.add(readNotificationId);
      accountedUnreadIdsRef.current.delete(readNotificationId);
    }
    if (safeCount === 0) {
      accountedUnreadIdsRef.current.forEach(id => knownReadIdsRef.current.add(id));
      accountedUnreadIdsRef.current.clear();
      setUnreadNotificationCount(0);
      return;
    }
    setUnreadNotificationCount(safeCount);
  }, []);

  // Apply theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Connect SSE notification stream & load initial unread count on authentication
  useEffect(() => {
    if (!currentUser) {
      notificationStreamService.disconnect();
      accountedUnreadIdsRef.current.clear();
      knownReadIdsRef.current.clear();
      setUnreadNotificationCount(0);
      return;
    }

    const userId = currentUser.id;
    accountedUnreadIdsRef.current.clear();
    knownReadIdsRef.current.clear();
    setUnreadNotificationCount(0);

    notificationStreamService.connect(userId);

    // Fetch initial unread count according to authenticated role
    let isMounted = true;
    const fetchInitialUnread = async () => {
      try {
        let list: Array<{ id: number; isRead?: number | boolean }> = [];
        if (currentUser.role === 'STUDENT') {
          list = await studentService.getNotifications(userId);
        } else if (currentUser.role === 'TEACHER') {
          list = await teacherService.getNotifications(userId);
        }
        if (!isMounted) return;

        let newlyDiscoveredUnread = 0;
        for (const item of list) {
          const itemId = Number(item.id);
          if (!itemId || isNaN(itemId) || itemId <= 0) continue;

          const isItemRead = Number(item.isRead) === 1 || item.isRead === true;
          if (isItemRead) {
            knownReadIdsRef.current.add(itemId);
            accountedUnreadIdsRef.current.delete(itemId);
          } else {
            // Unread in persistent storage
            if (!knownReadIdsRef.current.has(itemId) && !accountedUnreadIdsRef.current.has(itemId)) {
              accountedUnreadIdsRef.current.add(itemId);
              newlyDiscoveredUnread++;
            }
          }
        }

        // Add newly discovered unread items from REST without overwriting SSE events that arrived during the fetch
        setUnreadNotificationCount(prev => Math.max(0, prev + newlyDiscoveredUnread));
      } catch {
        // Safe fallback
      }
    };

    fetchInitialUnread();

    // Subscribe to incoming real-time notifications to increment count
    const unsubscribe = notificationStreamService.onNotification((incoming: RealtimeNotificationPayload) => {
      const recipientId = incoming.recipientId ?? incoming.userId;
      if (recipientId !== userId) {
        return;
      }

      const notifId = Number(incoming.id);
      if (!notifId || isNaN(notifId) || notifId <= 0) {
        return;
      }

      // If incoming notification is marked read, track it as read
      if (Number(incoming.isRead) === 1) {
        knownReadIdsRef.current.add(notifId);
        if (accountedUnreadIdsRef.current.has(notifId)) {
          accountedUnreadIdsRef.current.delete(notifId);
          setUnreadNotificationCount(prev => Math.max(0, prev - 1));
        }
        return;
      }

      // If already known to be read in this session, do not re-increment
      if (knownReadIdsRef.current.has(notifId)) {
        return;
      }

      // If already accounted for as unread, ignore duplicate SSE event
      if (accountedUnreadIdsRef.current.has(notifId)) {
        return;
      }

      // Fresh unread notification
      accountedUnreadIdsRef.current.add(notifId);
      setUnreadNotificationCount(prev => Math.max(0, prev + 1));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [currentUser]);

  // Restore authenticated session on mount via HttpOnly cookie
  useEffect(() => {
    let isCancelled = false;
    const initialEpoch = authService.getSessionEpoch();

    const restoreSession = async () => {
      try {
        const freshUser = await authService.getMe();
        if (!isCancelled && authService.getSessionEpoch() === initialEpoch) {
          setCurrentUser(freshUser);
          if (freshUser.role === 'STUDENT' || freshUser.role === 'TEACHER' || freshUser.role === 'ADMIN') {
            setLoginRole(freshUser.role);
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const isStale =
            (err as { isStale?: boolean })?.isStale ||
            (err as { message?: string })?.message === 'STALE_SESSION_RESPONSE' ||
            authService.getSessionEpoch() !== initialEpoch;

          if (isStale) {
            // Stale response: epoch changed while /auth/me was in-flight.
            // Do NOT wipe newer state or display expired notice.
            return;
          }

          const apiErr = err as { status?: number };
          const hadStoredUser = Boolean(authService.getStoredUser());
          authService.setStoredUser(null);
          setCurrentUser(null);
          notificationStreamService.disconnect();
          setUnreadNotificationCount(0);
          if (hadStoredUser || apiErr?.status === 401) {
            setSessionExpiredNotice('Your session has expired. Please sign in again.');
          }
        }
      } finally {
        if (!isCancelled) {
          setIsInitializing(false);
        }
      }
    };

    restoreSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Subscribe to cross-tab remote logout synchronization events
  useEffect(() => {
    const unsubscribe = sessionSync.onRemoteLogout(() => {
      notificationStreamService.disconnect();
      accountedUnreadIdsRef.current.clear();
      knownReadIdsRef.current.clear();
      setUnreadNotificationCount(0);
      authService.handleRemoteLogout();
      setCurrentUser(null);
      setLogoutNotice('You have been logged out from another browser tab or window.');
      setSessionExpiredNotice(null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Register unauthorized listener to handle token revocation & 401
  useEffect(() => {
    apiClient.onUnauthorized(() => {
      notificationStreamService.disconnect();
      accountedUnreadIdsRef.current.clear();
      knownReadIdsRef.current.clear();
      setUnreadNotificationCount(0);
      authService.setStoredUser(null);
      setCurrentUser(null);
      setSessionExpiredNotice('Your session has expired or the token was revoked. Please log in again.');
    });
  }, []);

  // Handle Logout (Workflow 8)
  const handleLogout = useCallback(async () => {
    notificationStreamService.disconnect();
    accountedUnreadIdsRef.current.clear();
    knownReadIdsRef.current.clear();
    setUnreadNotificationCount(0);
    try {
      await authService.logout();
    } finally {
      setCurrentUser(null);
      setLogoutNotice('You have been logged out successfully. All server tokens and session cookies have been invalidated.');
    }
  }, []);

  // -------------------------------------------------------------
  // INITIALIZING / SESSION RESTORATION STATE
  // -------------------------------------------------------------
  if (isInitializing) {
    return (
      <div className="app-container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--color-neutral-600, #4b5563)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>Loading session...</div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // UNAUTHENTICATED STATE
  // -------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="app-container">
        {logoutNotice && (
          <div style={{ maxWidth: '600px', margin: '20px auto 0 auto', padding: '0 16px' }}>
            <Alert variant="info" onDismiss={() => setLogoutNotice(null)}>
              {logoutNotice}
            </Alert>
          </div>
        )}

        {/* Portal Switcher */}
        <div style={{ maxWidth: '520px', margin: '20px auto 0 auto', display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <Button
            variant={loginRole === 'TEACHER' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              setLoginRole('TEACHER');
              setSessionExpiredNotice(null);
              setStudentAuthMode('login');
            }}
          >
            Faculty Portal
          </Button>
          <Button
            variant={loginRole === 'STUDENT' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              setLoginRole('STUDENT');
              setSessionExpiredNotice(null);
            }}
          >
            Student Portal
          </Button>
          <Button
            variant={loginRole === 'ADMIN' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              setLoginRole('ADMIN');
              setSessionExpiredNotice(null);
              setStudentAuthMode('login');
            }}
          >
            Admin Portal
          </Button>
        </div>

        {loginRole === 'TEACHER' && (
          <TeacherLoginView
            onLoginSuccess={user => {
              setCurrentUser(user as unknown as AuthUser);
              setSessionExpiredNotice(null);
              setLogoutNotice(null);
              setTeacherTab('teacher-pending');
            }}
            sessionExpiredMessage={sessionExpiredNotice || undefined}
          />
        )}
        {loginRole === 'STUDENT' && studentAuthMode === 'login' && (
          <StudentLoginView
            onLoginSuccess={user => {
              setCurrentUser(user as unknown as AuthUser);
              setSessionExpiredNotice(null);
              setLogoutNotice(null);
              setRegisteredNotice(null);
              setStudentTab('student-appointments');
            }}
            sessionExpiredMessage={sessionExpiredNotice || undefined}
            registeredSuccessMessage={registeredNotice || undefined}
            onNavigateToRegister={() => {
              setRegisteredNotice(null);
              setSessionExpiredNotice(null);
              setStudentAuthMode('register');
            }}
          />
        )}
        {loginRole === 'STUDENT' && studentAuthMode === 'register' && (
          <StudentRegisterView
            onRegisterSuccess={user => {
              setCurrentUser(user as unknown as AuthUser);
              setSessionExpiredNotice(null);
              setLogoutNotice(null);
              setRegisteredNotice(null);
              setStudentTab('student-appointments');
            }}
            onNavigateToLogin={() => {
              setStudentAuthMode('login');
            }}
          />
        )}
        {loginRole === 'ADMIN' && (
          <AdminLoginView
            onLoginSuccess={user => {
              setCurrentUser(user as unknown as AuthUser);
              setSessionExpiredNotice(null);
              setLogoutNotice(null);
              setAdminTab('admin-appointments');
            }}
            sessionExpiredMessage={sessionExpiredNotice || undefined}
          />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // FACULTY / TEACHER PORTAL WORKSPACE
  // -------------------------------------------------------------
  if (currentUser.role === 'TEACHER') {
    const teacherId = currentUser.profile?.id || currentUser.id;

    return (
      <div className="app-container">
        {/* Universal Top Header */}
        <Header
          currentRole="TEACHER"
          userName={`${currentUser.firstName} ${currentUser.lastName}`}
          userEmail={currentUser.email}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        {/* Faculty Navigation Bar */}
        <RoleNav
          currentRole="TEACHER"
          activeItemId={teacherTab}
          onSelectItem={id => {
            if (
              id === 'teacher-pending' ||
              id === 'teacher-schedule' ||
              id === 'teacher-availability' ||
              id === 'teacher-notifications' ||
              id === 'teacher-profile'
            ) {
              setTeacherTab(id as TeacherTabId);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        {/* Mobile Navigation Drawer */}
        <MobileNav
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          currentRole="TEACHER"
          activeItemId={teacherTab}
          onSelectItem={id => {
            if (
              id === 'teacher-pending' ||
              id === 'teacher-schedule' ||
              id === 'teacher-availability' ||
              id === 'teacher-notifications' ||
              id === 'teacher-profile'
            ) {
              setTeacherTab(id as TeacherTabId);
              setMobileMenuOpen(false);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        {/* Faculty Workspace Content */}
        <main className="content-wrapper">
          {teacherTab === 'teacher-pending' && (
            <TeacherRequestsView
              onNavigateToSchedule={() => setTeacherTab('teacher-schedule')}
            />
          )}

          {teacherTab === 'teacher-schedule' && (
            <TeacherScheduleView
              teacherId={teacherId}
              onNavigateToAvailability={() => setTeacherTab('teacher-availability')}
            />
          )}

          {teacherTab === 'teacher-availability' && (
            <TeacherAvailabilityView teacherId={teacherId} />
          )}

          {teacherTab === 'teacher-notifications' && (
            <TeacherNotificationsView
              userId={currentUser.id}
              onNavigateToRequests={() => setTeacherTab('teacher-pending')}
              onUnreadCountChange={handleUnreadCountChange}
            />
          )}

          {teacherTab === 'teacher-profile' && (
            <TeacherProfileView
              userId={currentUser.id}
              onProfileUpdated={updated => {
                setCurrentUser(prev =>
                  prev
                    ? {
                        ...prev,
                        firstName: updated.firstName,
                        lastName: updated.lastName,
                        profile: prev.profile
                          ? {
                              ...prev.profile,
                              designation: updated.profile?.designation ?? prev.profile.designation,
                              officeRoom: updated.profile?.officeRoom ?? prev.profile.officeRoom,
                              bio: updated.profile?.bio ?? prev.profile.bio
                            }
                          : undefined
                      }
                    : null
                );
              }}
            />
          )}
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STUDENT PORTAL WORKSPACE (Preserved)
  // -------------------------------------------------------------
  if (currentUser.role === 'STUDENT') {
    return (
      <div className="app-container">
        <Header
          currentRole="STUDENT"
          userName={`${currentUser.firstName} ${currentUser.lastName}`}
          userEmail={currentUser.email}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <RoleNav
          currentRole="STUDENT"
          activeItemId={studentTab}
          onSelectItem={id => {
            if (
              id === 'student-appointments' ||
              id === 'student-teachers' ||
              id === 'student-notifications' ||
              id === 'student-profile'
            ) {
              setStudentTab(id as StudentTabId);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        <MobileNav
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          currentRole="STUDENT"
          activeItemId={studentTab}
          onSelectItem={id => {
            if (
              id === 'student-appointments' ||
              id === 'student-teachers' ||
              id === 'student-notifications' ||
              id === 'student-profile'
            ) {
              setStudentTab(id as StudentTabId);
              setMobileMenuOpen(false);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        <main className="content-wrapper">
          {studentTab === 'student-appointments' && (
            <StudentAppointmentsView
              onNavigateToDirectory={() => setStudentTab('student-teachers')}
            />
          )}

          {studentTab === 'student-teachers' && (
            <FindTeachersView
              onAppointmentBooked={() => setStudentTab('student-appointments')}
            />
          )}

          {studentTab === 'student-notifications' && (
            <StudentNotificationsView
              userId={currentUser.id}
              onNavigateToAppointments={() => setStudentTab('student-appointments')}
              onUnreadCountChange={handleUnreadCountChange}
            />
          )}

          {studentTab === 'student-profile' && (
            <StudentProfileView
              userId={currentUser.id}
              onProfileUpdated={updated => {
                setCurrentUser(prev =>
                  prev
                    ? {
                        ...prev,
                        firstName: updated.firstName,
                        lastName: updated.lastName
                      }
                    : null
                );
              }}
            />
          )}
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------
  // ADMIN PORTAL WORKSPACE (Preserved)
  // -------------------------------------------------------------
  return (
    <div className="app-container">
      <Header
        currentRole="ADMIN"
        userName={`${currentUser.firstName} ${currentUser.lastName}`}
        userEmail={currentUser.email}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
        onLogout={handleLogout}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
      />

      <RoleNav
        currentRole="ADMIN"
        activeItemId={adminTab}
        onSelectItem={id => {
          if (
            id === 'admin-appointments' ||
            id === 'admin-teachers' ||
            id === 'admin-users' ||
            id === 'admin-audit' ||
            id === 'admin-health'
          ) {
            setAdminTab(id as AdminTabId);
          }
        }}
      />

      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        currentRole="ADMIN"
        activeItemId={adminTab}
        onSelectItem={id => {
          if (
            id === 'admin-appointments' ||
            id === 'admin-teachers' ||
            id === 'admin-users' ||
            id === 'admin-audit' ||
            id === 'admin-health'
          ) {
            setAdminTab(id as AdminTabId);
            setMobileMenuOpen(false);
          }
        }}
      />

      <main className="content-wrapper">
        {adminTab === 'admin-appointments' && <AppointmentMonitorView />}
        {adminTab === 'admin-teachers' && <TeacherManagementView />}
        {adminTab === 'admin-users' && <UserAccountsView />}
        {adminTab === 'admin-audit' && <AuditLogsView />}
        {adminTab === 'admin-health' && <SystemStatusView />}
      </main>
    </div>
  );
};
