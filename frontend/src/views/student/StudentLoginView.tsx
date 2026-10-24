/**
 * Student Login View
 * Secure, accessible authentication interface for university students.
 */

import React, { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { UserIcon, LockIcon } from '../../components/Icons/Icons';
import { authService } from '../../services/authService';
import { StudentUser } from '../../types/student';

interface StudentLoginViewProps {
  onLoginSuccess: (user: StudentUser) => void;
  sessionExpiredMessage?: string;
}

export const StudentLoginView: React.FC<StudentLoginViewProps> = ({
  onLoginSuccess,
  sessionExpiredMessage
}) => {
  const [email, setEmail] = useState('alice.carter@student.university.edu');
  const [password, setPassword] = useState('Password123!');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(sessionExpiredMessage || null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const errors: { email?: string; password?: string } = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email.trim()) {
      errors.email = 'Academic email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      errors.email = 'Please enter a valid student email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await authService.login(email.trim(), password);
      if (data.user.role !== 'STUDENT') {
        throw new Error('Access denied. Please use the designated portal for your role.');
      }
      onLoginSuccess(data.user as unknown as StudentUser);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Authentication failed. Please verify your student credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="surface-card" style={{ maxWidth: '440px', width: '100%', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary-800)',
              color: '#FFFFFF',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px'
            }}
            aria-hidden="true"
          >
            <UserIcon size={24} />
          </div>
          <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'bold', marginBottom: '4px' }}>
            Student Appointment Portal
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Sign in to request faculty consultations and manage your schedule.
          </p>
        </div>

        {errorMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="error" title="Sign In Notice">
              {errorMessage}
            </Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <FormField
            label="Student Email Address"
            htmlFor="student-email"
            required
            error={fieldErrors.email}
            helperText="e.g. alice.carter@student.university.edu"
          >
            <TextInput
              id="student-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isLoading}
              error={Boolean(fieldErrors.email)}
              autoComplete="email"
              autoFocus
            />
          </FormField>

          <FormField
            label="Password"
            htmlFor="student-password"
            required
            error={fieldErrors.password}
          >
            <TextInput
              id="student-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isLoading}
              error={Boolean(fieldErrors.password)}
              autoComplete="current-password"
            />
          </FormField>

          <div style={{ marginTop: '24px' }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              leadingIcon={<LockIcon size={18} />}
            >
              Sign In as Student
            </Button>
          </div>
        </form>

        <div style={{ marginTop: '20px', padding: '12px', backgroundColor: 'var(--color-bg-surface-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          <strong>Demo Student Credentials:</strong><br />
          Email: <code className="code-identifier">alice.carter@student.university.edu</code><br />
          Password: <code className="code-identifier">Password123!</code>
        </div>
      </div>
    </div>
  );
};
