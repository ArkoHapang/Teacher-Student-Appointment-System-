/**
 * Teacher–Student Appointment System
 *
 * Implements Faculty / Teacher / Student / Admin Permitted Workflows
 * Synchronizes SPA navigation with browser history (popstate / pushState)
 * Provides Public Landing Page and Credential Recovery & Verification Modals.
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

// Public & Onboarding Views
import { LandingView } from './views/public/LandingView';
import { ForgotPasswordModal } from './views/public/ForgotPasswordModal';
import { ResetPasswordModal } from './views/public/ResetPasswordModal';
import { VerifyEmailModal } from './views/public/VerifyEmailModal';
import { TeacherOnboardModal } from './views/public/TeacherOnboardModal';

// Faculty / Teacher Views
import { TeacherLoginView } from './views/teacher/TeacherLoginView';
import { TeacherRequestsView } from './views/teacher/TeacherRequestsView';
import { TeacherScheduleView } from './views/teacher/TeacherScheduleView';
import { TeacherAvailabilityView } from './views/teacher/TeacherAvailabilityView';
import { TeacherNotificationsView } from './views/teacher/TeacherNotificationsView';
import { TeacherProfileView } from './views/teacher/TeacherProfileView';

// Student & Admin Views
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

type PublicScreen = 'landing' | 'portal';

export const App: React.FC = () => {
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => authService.getStoredUser());
  const [publicScreen, setPublicScreen] = useState<PublicScreen>('landing');
  const [loginRole, setLoginRole] = useState<'TEACHER' | 'STUDENT' | 'ADMIN'>('STUDENT');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Navigation tab states
  const [teacherTab, setTeacherTab] = useState<TeacherTabId>('teacher-pending');
  const [studentTab, setStudentTab] = useState<StudentTabId>('student-appointments');
  const [adminTab, setAdminTab] = useState<AdminTabId>('admin-appointments');

  // Modals & notices
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [studentAuthMode, setStudentAuthMode] = useState<'login' | 'register'>('login');
  const [registeredNotice, setRegisteredNotice] = useState<string | null>(null);

  // Auth Dialog Modals
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isVerifyEmailOpen, setIsVerifyEmailOpen] = useState(false);
  const [isTeacherOnboardOpen, setIsTeacherOnboardOpen] = useState(false);
  const [initialDialogToken, setInitialDialogToken] = useState('');

  // Real-time notification counters
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const accountedUnreadIdsRef = useRef<Set<number>>(new Set());
  const knownReadIdsRef = useRef<Set<number>>(new Set());

  // SPA History Navigation: push route to history without exiting application
  const navigateRoute = useCallback((hash: string, replace = false) => {
    if (typeof window === 'undefined') return;
    const currentHash = window.location.hash;
    if (currentHash === hash) return;
    if (replace) {
      window.history.replaceState({ hash }, '', hash);
    } else {
      window.history.pushState({ hash }, '', hash);
    }
  }, []);

  // Parse location hash and synchronize view state
  const syncWithHash = useCallback(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '#/';

    // Dialog routes
    if (hash.startsWith('#/reset-password')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      setInitialDialogToken(params.get('token') || '');
      setIsResetPasswordOpen(true);
      return;
    }
    if (hash.startsWith('#/verify-email')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      setInitialDialogToken(params.get('token') || '');
      setIsVerifyEmailOpen(true);
      return;
    }
    if (hash.startsWith('#/onboard-teacher')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      setInitialDialogToken(params.get('token') || '');
      setIsTeacherOnboardOpen(true);
      return;
    }
    if (hash === '#/forgot-password') {
      setIsForgotPasswordOpen(true);
      return;
    }

    // Role portal routes (Unauthenticated)
    if (hash === '#/login/student') {
      setPublicScreen('portal');
      setLoginRole('STUDENT');
      setStudentAuthMode('login');
      return;
    }
    if (hash === '#/login/teacher' || hash === '#/login/faculty') {
      setPublicScreen('portal');
      setLoginRole('TEACHER');
      return;
    }
    if (hash === '#/login/admin') {
      setPublicScreen('portal');
      setLoginRole('ADMIN');
      return;
    }
    if (hash === '#/register') {
      setPublicScreen('portal');
      setLoginRole('STUDENT');
      setStudentAuthMode('register');
      return;
    }
    if (hash === '#/' || hash === '' || hash === '#home') {
      if (!authService.getStoredUser()) {
        setPublicScreen('landing');
      }
      return;
    }

    // Authenticated Tab routes
    if (hash === '#/teacher/pending' || hash === '#teacher-requests') setTeacherTab('teacher-pending');
    else if (hash === '#/teacher/schedule' || hash === '#teacher-schedule') setTeacherTab('teacher-schedule');
    else if (hash === '#/teacher/availability' || hash === '#teacher-availability') setTeacherTab('teacher-availability');
    else if (hash === '#/teacher/notifications' || hash === '#teacher-notifications') setTeacherTab('teacher-notifications');
    else if (hash === '#/teacher/profile' || hash === '#teacher-profile') setTeacherTab('teacher-profile');
    else if (hash === '#/student/appointments' || hash === '#appointments') setStudentTab('student-appointments');
    else if (hash === '#/student/teachers' || hash === '#teachers') setStudentTab('student-teachers');
    else if (hash === '#/student/notifications' || hash === '#notifications') setStudentTab('student-notifications');
    else if (hash === '#/student/profile' || hash === '#profile') setStudentTab('student-profile');
    else if (hash === '#/admin/appointments' || hash === '#admin-appointments') setAdminTab('admin-appointments');
    else if (hash === '#/admin/teachers' || hash === '#admin-teachers') setAdminTab('admin-teachers');
    else if (hash === '#/admin/users' || hash === '#admin-users') setAdminTab('admin-users');
    else if (hash === '#/admin/audit' || hash === '#admin-audit') setAdminTab('admin-audit');
    else if (hash === '#/admin/health' || hash === '#admin-health') setAdminTab('admin-health');
  }, []);

  // Listen to popstate and hashchange for browser Back / Forward buttons and hash navigation (Issues #54, #59)
  useEffect(() => {
    const handleNavigation = () => {
      syncWithHash();
    };
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
    syncWithHash();
    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
    };
  }, [syncWithHash]);

  // Brand navigation link handler (Issue #61)
  const handleBrandClick = useCallback(() => {
    if (!currentUser) {
      setPublicScreen('landing');
      navigateRoute('#/');
    } else {
      if (currentUser.role === 'STUDENT') {
        setStudentTab('student-appointments');
        navigateRoute('#/student/appointments');
      } else if (currentUser.role === 'TEACHER') {
        setTeacherTab('teacher-pending');
        navigateRoute('#/teacher/pending');
      } else if (currentUser.role === 'ADMIN') {
        setAdminTab('admin-appointments');
        navigateRoute('#/admin/appointments');
      }
    }
  }, [currentUser, navigateRoute]);

  // Reconcile unread notification count
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
            if (!knownReadIdsRef.current.has(itemId) && !accountedUnreadIdsRef.current.has(itemId)) {
              accountedUnreadIdsRef.current.add(itemId);
              newlyDiscoveredUnread++;
            }
          }
        }

        setUnreadNotificationCount(prev => Math.max(0, prev + newlyDiscoveredUnread));
      } catch {
        // Safe fallback
      }
    };

    fetchInitialUnread();

    const unsubscribe = notificationStreamService.onNotification((incoming: RealtimeNotificationPayload) => {
      const recipientId = incoming.recipientId ?? incoming.userId;
      if (recipientId !== userId) return;

      const notifId = Number(incoming.id);
      if (!notifId || isNaN(notifId) || notifId <= 0) return;

      if (Number(incoming.isRead) === 1) {
        knownReadIdsRef.current.add(notifId);
        if (accountedUnreadIdsRef.current.has(notifId)) {
          accountedUnreadIdsRef.current.delete(notifId);
          setUnreadNotificationCount(prev => Math.max(0, prev - 1));
        }
        return;
      }

      if (knownReadIdsRef.current.has(notifId) || accountedUnreadIdsRef.current.has(notifId)) {
        return;
      }

      accountedUnreadIdsRef.current.add(notifId);
      setUnreadNotificationCount(prev => Math.max(0, prev + 1));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [currentUser]);

  // Restore authenticated session on mount via HttpOnly cookie (Issue #53)
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

          if (isStale) return;

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

  // Remote logout listener across tabs
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
      setPublicScreen('landing');
      navigateRoute('#/');
    });

    return () => {
      unsubscribe();
    };
  }, [navigateRoute]);

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
      setPublicScreen('portal');
      navigateRoute('#/login/student');
    });
  }, [navigateRoute]);

  // Handle Logout
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
      setPublicScreen('landing');
      navigateRoute('#/');
    }
  }, [navigateRoute]);

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
        {/* Top Header for Unauthenticated State */}
        <Header
          currentRole="STUDENT"
          userName="University Guest"
          userEmail="Please sign in"
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          onLogout={() => {
            setPublicScreen('landing');
            navigateRoute('#/');
          }}
          onBrandClick={handleBrandClick}
        />

        {logoutNotice && (
          <div style={{ maxWidth: '600px', margin: '20px auto 0 auto', padding: '0 16px' }}>
            <Alert variant="info" onDismiss={() => setLogoutNotice(null)}>
              {logoutNotice}
            </Alert>
          </div>
        )}

        {/* Public Landing View (Issue #59) */}
        {publicScreen === 'landing' ? (
          <LandingView
            onSelectRole={role => {
              setLoginRole(role);
              setPublicScreen('portal');
              setStudentAuthMode('login');
              setSessionExpiredNotice(null);
              navigateRoute(`#/login/${role.toLowerCase()}`);
            }}
            onNavigateToRegister={() => {
              setLoginRole('STUDENT');
              setPublicScreen('portal');
              setStudentAuthMode('register');
              setRegisteredNotice(null);
              setSessionExpiredNotice(null);
              navigateRoute('#/register');
            }}
            onForgotPassword={() => setIsForgotPasswordOpen(true)}
            onVerifyEmail={() => setIsVerifyEmailOpen(true)}
          />
        ) : (
          <div>
            {/* Portal Navigation Switcher */}
            <div style={{ maxWidth: '600px', margin: '20px auto 0 auto', padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPublicScreen('landing');
                  navigateRoute('#/');
                }}
              >
                &larr; Back to Home
              </Button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant={loginRole === 'STUDENT' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setLoginRole('STUDENT');
                    setSessionExpiredNotice(null);
                    navigateRoute('#/login/student');
                  }}
                >
                  Student Portal
                </Button>
                <Button
                  variant={loginRole === 'TEACHER' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setLoginRole('TEACHER');
                    setSessionExpiredNotice(null);
                    setStudentAuthMode('login');
                    navigateRoute('#/login/teacher');
                  }}
                >
                  Faculty Portal
                </Button>
                <Button
                  variant={loginRole === 'ADMIN' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setLoginRole('ADMIN');
                    setSessionExpiredNotice(null);
                    setStudentAuthMode('login');
                    navigateRoute('#/login/admin');
                  }}
                >
                  Admin Portal
                </Button>
              </div>
            </div>

            {loginRole === 'TEACHER' && (
              <TeacherLoginView
                onLoginSuccess={user => {
                  setCurrentUser(user as unknown as AuthUser);
                  setSessionExpiredNotice(null);
                  setLogoutNotice(null);
                  setTeacherTab('teacher-pending');
                  navigateRoute('#/teacher/pending');
                }}
                sessionExpiredMessage={sessionExpiredNotice || undefined}
                onForgotPassword={() => setIsForgotPasswordOpen(true)}
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
                  navigateRoute('#/student/appointments');
                }}
                sessionExpiredMessage={sessionExpiredNotice || undefined}
                registeredSuccessMessage={registeredNotice || undefined}
                onNavigateToRegister={() => {
                  setRegisteredNotice(null);
                  setSessionExpiredNotice(null);
                  setStudentAuthMode('register');
                  navigateRoute('#/register');
                }}
                onForgotPassword={() => setIsForgotPasswordOpen(true)}
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
                  navigateRoute('#/student/appointments');
                }}
                onNavigateToLogin={() => {
                  setStudentAuthMode('login');
                  navigateRoute('#/login/student');
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
                  navigateRoute('#/admin/appointments');
                }}
                sessionExpiredMessage={sessionExpiredNotice || undefined}
              />
            )}
          </div>
        )}

        {/* Global Dialog Modals */}
        <ForgotPasswordModal
          isOpen={isForgotPasswordOpen}
          onClose={() => setIsForgotPasswordOpen(false)}
          onOpenResetPassword={() => {
            setIsForgotPasswordOpen(false);
            setIsResetPasswordOpen(true);
          }}
        />

        <ResetPasswordModal
          isOpen={isResetPasswordOpen}
          onClose={() => setIsResetPasswordOpen(false)}
          initialToken={initialDialogToken}
          onSuccess={() => {
            setPublicScreen('portal');
            setLoginRole('STUDENT');
            setStudentAuthMode('login');
            navigateRoute('#/login/student');
          }}
        />

        <VerifyEmailModal
          isOpen={isVerifyEmailOpen}
          onClose={() => setIsVerifyEmailOpen(false)}
          initialToken={initialDialogToken}
          onSuccess={() => {
            setPublicScreen('portal');
            setLoginRole('STUDENT');
            setStudentAuthMode('login');
            setRegisteredNotice('Email verified successfully! You may now sign in.');
            navigateRoute('#/login/student');
          }}
        />

        <TeacherOnboardModal
          isOpen={isTeacherOnboardOpen}
          onClose={() => setIsTeacherOnboardOpen(false)}
          initialToken={initialDialogToken}
          onSuccess={() => {
            setPublicScreen('portal');
            setLoginRole('TEACHER');
            navigateRoute('#/login/teacher');
          }}
        />
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
          userName={`${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Faculty Member'}
          userEmail={currentUser.email}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onBrandClick={handleBrandClick}
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
              navigateRoute(`#/teacher/${id.replace('teacher-', '')}`);
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
              navigateRoute(`#/teacher/${id.replace('teacher-', '')}`);
              setMobileMenuOpen(false);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        {/* Faculty Workspace Content */}
        <main className="content-wrapper">
          {teacherTab === 'teacher-pending' && (
            <TeacherRequestsView
              onNavigateToSchedule={() => {
                setTeacherTab('teacher-schedule');
                navigateRoute('#/teacher/schedule');
              }}
            />
          )}

          {teacherTab === 'teacher-schedule' && (
            <TeacherScheduleView
              teacherId={teacherId}
              onNavigateToAvailability={() => {
                setTeacherTab('teacher-availability');
                navigateRoute('#/teacher/availability');
              }}
            />
          )}

          {teacherTab === 'teacher-availability' && (
            <TeacherAvailabilityView teacherId={teacherId} />
          )}

          {teacherTab === 'teacher-notifications' && (
            <TeacherNotificationsView
              userId={currentUser.id}
              onNavigateToRequests={() => {
                setTeacherTab('teacher-pending');
                navigateRoute('#/teacher/pending');
              }}
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
  // STUDENT PORTAL WORKSPACE
  // -------------------------------------------------------------
  if (currentUser.role === 'STUDENT') {
    return (
      <div className="app-container">
        <Header
          currentRole="STUDENT"
          userName={`${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Student'}
          userEmail={currentUser.email}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onBrandClick={handleBrandClick}
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
              navigateRoute(`#/student/${id.replace('student-', '')}`);
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
              navigateRoute(`#/student/${id.replace('student-', '')}`);
              setMobileMenuOpen(false);
            }
          }}
          unreadNotificationsCount={unreadNotificationCount}
        />

        <main className="content-wrapper">
          {studentTab === 'student-appointments' && (
            <StudentAppointmentsView
              onNavigateToDirectory={() => {
                setStudentTab('student-teachers');
                navigateRoute('#/student/teachers');
              }}
            />
          )}

          {studentTab === 'student-teachers' && (
            <FindTeachersView
              onAppointmentBooked={() => {
                setStudentTab('student-appointments');
                navigateRoute('#/student/appointments');
              }}
            />
          )}

          {studentTab === 'student-notifications' && (
            <StudentNotificationsView
              userId={currentUser.id}
              onNavigateToAppointments={() => {
                setStudentTab('student-appointments');
                navigateRoute('#/student/appointments');
              }}
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
  // ADMIN PORTAL WORKSPACE
  // -------------------------------------------------------------
  return (
    <div className="app-container">
      <Header
        currentRole="ADMIN"
        userName={`${currentUser.firstName} ${currentUser.lastName}`.trim() || 'Administrator'}
        userEmail={currentUser.email}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
        onLogout={handleLogout}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        onBrandClick={handleBrandClick}
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
            navigateRoute(`#/admin/${id.replace('admin-', '')}`);
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
            navigateRoute(`#/admin/${id.replace('admin-', '')}`);
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
