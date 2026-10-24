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

import React, { useState, useEffect, useCallback } from 'react';
import { AuthUser, authService } from './services/authService';
import { apiClient } from './services/apiClient';
import { Header, RoleNav, MobileNav } from './components/Navigation/Navigation';
import { Alert } from './components/Alert/Alert';
import { Button } from './components/Button/Button';

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
import { StudentAppointmentsView } from './views/student/StudentAppointmentsView';
import { FindTeachersView } from './views/student/FindTeachersView';
import { StudentNotificationsView } from './views/student/StudentNotificationsView';
import { StudentProfileView } from './views/student/StudentProfileView';
import { AppointmentMonitorView } from './views/admin/AppointmentMonitorView';
import { TeacherManagementView } from './views/admin/TeacherManagementView';

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

type AdminTabId = 'admin-appointments' | 'admin-teachers';

export const App: React.FC = () => {
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

  // Apply theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Verify stored session on mount
  useEffect(() => {
    const verifySession = async () => {
      const stored = authService.getStoredUser();
      const token = apiClient.getToken();
      if (token && stored) {
        try {
          const freshUser = await authService.getMe();
          setCurrentUser(freshUser);
        } catch {
          // Token expired or revoked
          setCurrentUser(null);
          setSessionExpiredNotice('Your session has expired. Please sign in again.');
        }
      }
    };

    verifySession();
  }, []);

  // Register unauthorized listener to handle token revocation & 401
  useEffect(() => {
    apiClient.onUnauthorized(() => {
      setCurrentUser(null);
      setSessionExpiredNotice('Your session has expired or the token was revoked. Please log in again.');
    });
  }, []);

  // Handle Logout (Workflow 8)
  const handleLogout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setCurrentUser(null);
      setLogoutNotice('You have been logged out successfully. All server tokens and session cookies have been invalidated.');
    }
  }, []);

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
        {loginRole === 'STUDENT' && (
          <StudentLoginView
            onLoginSuccess={user => {
              setCurrentUser(user as unknown as AuthUser);
              setSessionExpiredNotice(null);
              setLogoutNotice(null);
              setStudentTab('student-appointments');
            }}
            sessionExpiredMessage={sessionExpiredNotice || undefined}
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
          if (id === 'admin-appointments' || id === 'admin-teachers') {
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
          if (id === 'admin-appointments' || id === 'admin-teachers') {
            setAdminTab(id as AdminTabId);
            setMobileMenuOpen(false);
          }
        }}
      />

      <main className="content-wrapper">
        {adminTab === 'admin-appointments' && <AppointmentMonitorView />}
        {adminTab === 'admin-teachers' && <TeacherManagementView />}
      </main>
    </div>
  );
};
