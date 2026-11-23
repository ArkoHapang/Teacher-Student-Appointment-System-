/**
 * Institutional Landing Page (Issue #59)
 * Welcoming public homepage providing system overview, role-specific portal entry points,
 * and academic service highlights.
 */

import React from 'react';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import {
  ClockIcon,
  UserIcon,
  ShieldIcon
} from '../../components/Icons/Icons';

interface LandingViewProps {
  onSelectRole: (role: 'STUDENT' | 'TEACHER' | 'ADMIN') => void;
  onNavigateToRegister: () => void;
  onForgotPassword: () => void;
  onVerifyEmail: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onSelectRole,
  onNavigateToRegister,
  onForgotPassword,
  onVerifyEmail
}) => {
  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 16px' }}>
      {/* Hero Section */}
      <section style={{ textAlign: 'center', marginBottom: '48px', paddingTop: '16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <Badge variant="info">University Academic Services</Badge>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            v1.1.0 Production Platform
          </span>
        </div>
        <h1
          style={{
            fontSize: 'var(--font-size-3xl, 2.25rem)',
            fontWeight: 800,
            color: 'var(--color-text-main)',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
            lineHeight: 1.2
          }}
        >
          Teacher–Student Appointment & Consultation Portal
        </h1>
        <p
          style={{
            fontSize: 'var(--font-size-lg)',
            color: 'var(--color-text-muted)',
            maxWidth: '680px',
            margin: '0 auto 24px auto',
            lineHeight: 1.5
          }}
        >
          A unified, reliable academic scheduling platform connecting students and faculty.
          Reserve consultation hours, coordinate research advising, and review academic progress seamlessly.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => onSelectRole('STUDENT')}
            leadingIcon={<UserIcon size={18} />}
          >
            Access Student Portal
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => onSelectRole('TEACHER')}
            leadingIcon={<ClockIcon size={18} />}
          >
            Access Faculty Portal
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onNavigateToRegister}
          >
            Create Student Account
          </Button>
        </div>
      </section>

      {/* Role Portal Cards */}
      <section style={{ marginBottom: '56px' }}>
        <h2
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 700,
            color: 'var(--color-text-main)',
            textAlign: 'center',
            marginBottom: '28px'
          }}
        >
          Select Your Academic Portal
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '24px'
          }}
        >
          {/* Student Card */}
          <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-primary-100)',
                  color: 'var(--color-primary-800)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <UserIcon size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Student Portal</h3>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Undergraduate & Graduate</span>
              </div>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)', flex: 1, marginBottom: '20px' }}>
              Search departmental faculty directories, reserve available office-hour consultation slots, and track the status of your appointment requests in real-time.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Button
                variant="primary"
                size="md"
                fullWidth
                onClick={() => onSelectRole('STUDENT')}
              >
                Sign In as Student
              </Button>
              <Button
                variant="outline"
                size="sm"
                fullWidth
                onClick={onNavigateToRegister}
              >
                Register New Student Account
              </Button>
            </div>
          </div>

          {/* Faculty Card */}
          <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-primary-50)',
                  color: 'var(--color-primary-700)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ClockIcon size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Faculty Portal</h3>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Professors & Instructors</span>
              </div>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)', flex: 1, marginBottom: '20px' }}>
              Configure recurring office hours and availability slots, review and confirm consultation requests, leave academic guidance notes, and manage your teaching schedule.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => onSelectRole('TEACHER')}
              >
                Sign In as Faculty
              </Button>
            </div>
          </div>

          {/* Administrator Card */}
          <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-slate-100)',
                  color: 'var(--color-slate-800)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ShieldIcon size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>Administrative Portal</h3>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Department Officers & Admins</span>
              </div>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)', flex: 1, marginBottom: '20px' }}>
              Maintain academic faculty onboarding, verify teacher credentials, audit immutable system transactions, and monitor platform readiness and diagnostic telemetry.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Button
                variant="outline"
                size="md"
                fullWidth
                onClick={() => onSelectRole('ADMIN')}
              >
                Sign In as Administrator
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Institutional Highlights */}
      <section style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '40px', marginBottom: '40px' }}>
        <h2
          style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 700,
            color: 'var(--color-text-main)',
            textAlign: 'center',
            marginBottom: '24px'
          }}
        >
          Built for Academic Reliability
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          <div style={{ padding: '16px', backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-800)', marginBottom: '4px' }}>
              Conflict-Free Scheduling
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Deterministic interval-overlap checking protects against double-booking across concurrent student requests.
            </p>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-800)', marginBottom: '4px' }}>
              Immutable Audit Ledger
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Every lifecycle state transition, rescheduling decision, and administrative action is preserved with actor attribution.
            </p>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-800)', marginBottom: '4px' }}>
              Verified Credentials
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Cryptographically secure single-use token flows for institutional identity verification and password recovery.
            </p>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-800)', marginBottom: '4px' }}>
              Real-Time Notifications
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Server-Sent Event push streams keep students and faculty instantly notified of appointment approvals, changes, and notes.
            </p>
          </div>
        </div>
      </section>

      {/* Account Recovery & Verification Shortcuts */}
      <section style={{ textAlign: 'center', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '24px' }}>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
          Account Assistance:
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onForgotPassword}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary-700)',
              fontSize: 'var(--font-size-xs)',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Forgot Password Recovery
          </button>
          <span style={{ color: 'var(--color-border-subtle)' }}>&bull;</span>
          <button
            type="button"
            onClick={onVerifyEmail}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary-700)',
              fontSize: 'var(--font-size-xs)',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Verify Student Email
          </button>
        </div>
      </section>
    </div>
  );
};
