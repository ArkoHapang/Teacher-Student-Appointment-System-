/**
 * Student Self-Registration View
 * Public onboarding interface for university students.
 * Dynamic department discovery, client validation, and backend error handling.
 */

import React, { useState, useEffect } from 'react';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { UserIcon, LockIcon, ChevronLeftIcon } from '../../components/Icons/Icons';
import { authService } from '../../services/authService';
import { ApiError } from '../../services/apiClient';
import { StudentUser, DepartmentItem } from '../../types/student';

interface StudentRegisterViewProps {
  onRegisterSuccess: (user: StudentUser) => void;
  onNavigateToLogin: () => void;
}

export const StudentRegisterView: React.FC<StudentRegisterViewProps> = ({
  onRegisterSuccess,
  onNavigateToLogin
}) => {
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [studentIdNumber, setStudentIdNumber] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [batch, setBatch] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Department discovery state
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [isDeptLoading, setIsDeptLoading] = useState(true);
  const [deptLoadError, setDeptLoadError] = useState<string | null>(null);

  // Submission state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Fetch departments dynamically on mount
  useEffect(() => {
    let isMounted = true;

    const fetchDepartments = async () => {
      setIsDeptLoading(true);
      setDeptLoadError(null);
      try {
        const list = await authService.getDepartments();
        if (isMounted) {
          setDepartments(list);
          if (list.length > 0 && !departmentId) {
            // Leave empty to force explicit choice or default to first
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          const errorObj = err as { message?: string };
          setDeptLoadError(errorObj.message || 'Failed to load academic departments. Please refresh.');
        }
      } finally {
        if (isMounted) {
          setIsDeptLoading(false);
        }
      }
    };

    fetchDepartments();

    return () => {
      isMounted = false;
    };
  }, []);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Password complexity: 8-128 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
    const passwordComplexityRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,128}$/;

    if (!firstName.trim()) {
      errors.firstName = 'First name is required.';
    } else if (firstName.trim().length > 50) {
      errors.firstName = 'First name must not exceed 50 characters.';
    }

    if (!lastName.trim()) {
      errors.lastName = 'Last name is required.';
    } else if (lastName.trim().length > 50) {
      errors.lastName = 'Last name must not exceed 50 characters.';
    }

    if (!email.trim()) {
      errors.email = 'Academic email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      errors.email = 'Please enter a valid student email address.';
    }

    if (!studentIdNumber.trim()) {
      errors.studentIdNumber = 'Student ID number is required.';
    } else if (studentIdNumber.trim().length < 3 || studentIdNumber.trim().length > 30) {
      errors.studentIdNumber = 'Student ID must be between 3 and 30 characters.';
    }

    if (!departmentId) {
      errors.departmentId = 'Please select your academic department.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long.';
    } else if (!passwordComplexityRegex.test(password)) {
      errors.password =
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Password confirmation is required.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (batch.trim() && batch.trim().length > 20) {
      errors.batch = 'Batch identifier must not exceed 20 characters.';
    }

    if (phoneNumber.trim() && phoneNumber.trim().length > 20) {
      errors.phoneNumber = 'Phone number must not exceed 20 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!validate()) {
      setErrorMessage('Please correct the highlighted fields before submitting.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        studentIdNumber: studentIdNumber.trim(),
        departmentId: parseInt(departmentId, 10),
        batch: batch.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        password
      };

      const res = await authService.registerStudent(payload);
      onRegisterSuccess(res.user as unknown as StudentUser);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'DUPLICATE_EMAIL') {
          setFieldErrors(prev => ({
            ...prev,
            email: err.message || 'An account with this email address already exists.'
          }));
          setErrorMessage(err.message || 'An account with this email address already exists.');
        } else if (err.code === 'DUPLICATE_STUDENT_ID') {
          setFieldErrors(prev => ({
            ...prev,
            studentIdNumber: err.message || 'A student with this Student ID is already registered.'
          }));
          setErrorMessage(err.message || 'A student with this Student ID is already registered.');
        } else if (err.code === 'WEAK_PASSWORD') {
          setFieldErrors(prev => ({
            ...prev,
            password: err.message || 'Password does not meet complexity requirements.'
          }));
          setErrorMessage(err.message || 'Password does not meet complexity requirements.');
        } else if (err.code === 'DEPARTMENT_NOT_FOUND') {
          setFieldErrors(prev => ({
            ...prev,
            departmentId: err.message || 'The selected academic department does not exist.'
          }));
          setErrorMessage(err.message || 'The selected academic department does not exist.');
        } else if (err.code === 'RATE_LIMIT_EXCEEDED' || err.status === 429) {
          setErrorMessage('Too many registration requests. Please wait a few minutes before trying again.');
        } else if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details) && err.details.length > 0) {
          const backendFieldErrors: Record<string, string> = {};
          err.details.forEach((item: any) => {
            if (item && item.field && item.message) {
              backendFieldErrors[item.field] = item.message;
            }
          });
          setFieldErrors(backendFieldErrors);
          setErrorMessage(err.message || 'Validation failed. Please verify the highlighted information.');
        } else {
          setErrorMessage(err.message || 'Registration could not be completed. Please try again.');
        }
      } else {
        const errorObj = err as { message?: string };
        setErrorMessage(errorObj.message || 'An unexpected network error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="surface-card" style={{ maxWidth: '540px', width: '100%', boxShadow: 'var(--shadow-lg)' }}>
        {/* Header */}
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
            Student Account Registration
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Register your university student account to view faculty availability and request consultations.
          </p>
        </div>

        {/* Global Error Notice */}
        {errorMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="error" title="Registration Notice">
              {errorMessage}
            </Alert>
          </div>
        )}

        {/* Department Fetch Failure Notice */}
        {deptLoadError && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="warning" title="Department Discovery Notice">
              {deptLoadError}
            </Alert>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Name Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField
              label="First Name"
              htmlFor="reg-first-name"
              required
              error={fieldErrors.firstName}
            >
              <TextInput
                id="reg-first-name"
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.firstName)}
                autoComplete="given-name"
                autoFocus
              />
            </FormField>

            <FormField
              label="Last Name"
              htmlFor="reg-last-name"
              required
              error={fieldErrors.lastName}
            >
              <TextInput
                id="reg-last-name"
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.lastName)}
                autoComplete="family-name"
              />
            </FormField>
          </div>

          {/* Email */}
          <FormField
            label="Academic Email Address"
            htmlFor="reg-email"
            required
            error={fieldErrors.email}
            helperText="e.g. john.doe@student.university.edu"
          >
            <TextInput
              id="reg-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isLoading}
              error={Boolean(fieldErrors.email)}
              autoComplete="email"
            />
          </FormField>

          {/* Student ID & Department */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField
              label="Student ID Number"
              htmlFor="reg-student-id"
              required
              error={fieldErrors.studentIdNumber}
              helperText="e.g. STU-2026-0099"
            >
              <TextInput
                id="reg-student-id"
                type="text"
                value={studentIdNumber}
                onChange={e => setStudentIdNumber(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.studentIdNumber)}
              />
            </FormField>

            <FormField
              label="Academic Department"
              htmlFor="reg-department"
              required
              error={fieldErrors.departmentId}
            >
              <Select
                id="reg-department"
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                disabled={isLoading || isDeptLoading}
                error={Boolean(fieldErrors.departmentId)}
              >
                <option value="">
                  {isDeptLoading ? 'Loading departments...' : '-- Select Department --'}
                </option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name} ({dept.code})
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {/* Optional Batch & Phone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField
              label="Batch / Year (Optional)"
              htmlFor="reg-batch"
              error={fieldErrors.batch}
              helperText="e.g. 2026-A"
            >
              <TextInput
                id="reg-batch"
                type="text"
                value={batch}
                onChange={e => setBatch(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.batch)}
              />
            </FormField>

            <FormField
              label="Phone Number (Optional)"
              htmlFor="reg-phone"
              error={fieldErrors.phoneNumber}
              helperText="e.g. +1-555-0199"
            >
              <TextInput
                id="reg-phone"
                type="tel"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.phoneNumber)}
                autoComplete="tel"
              />
            </FormField>
          </div>

          {/* Password & Confirm Password */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField
              label="Password"
              htmlFor="reg-password"
              required
              error={fieldErrors.password}
              helperText="Min. 8 chars (uppercase, lowercase, number, symbol)"
            >
              <TextInput
                id="reg-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.password)}
                autoComplete="new-password"
              />
            </FormField>

            <FormField
              label="Confirm Password"
              htmlFor="reg-confirm-password"
              required
              error={fieldErrors.confirmPassword}
            >
              <TextInput
                id="reg-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                error={Boolean(fieldErrors.confirmPassword)}
                autoComplete="new-password"
              />
            </FormField>
          </div>

          {/* Submit Button */}
          <div style={{ marginTop: '20px' }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              leadingIcon={<LockIcon size={18} />}
            >
              Create Student Account
            </Button>
          </div>
        </form>

        {/* Back to Login Link */}
        <div style={{ marginTop: '20px', textAlign: 'center', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '16px' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
            Already have a student account?
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNavigateToLogin}
            disabled={isLoading}
            leadingIcon={<ChevronLeftIcon size={16} />}
          >
            Back to Student Sign In
          </Button>
        </div>
      </div>
    </div>
  );
};
