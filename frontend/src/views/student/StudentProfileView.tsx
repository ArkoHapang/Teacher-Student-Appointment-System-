/**
 * Student Profile View
 * Displays institutional academic details and allows updating permitted fields (firstName, lastName).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { studentService } from '../../services/studentService';
import { StudentUser } from '../../types/student';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState } from '../../components/Feedback/Feedback';
import { UserStatusBadge, Badge } from '../../components/Badge/Badge';
import { CheckIcon } from '../../components/Icons/Icons';

interface StudentProfileViewProps {
  userId: number;
  onProfileUpdated?: (user: StudentUser) => void;
}

export const StudentProfileView: React.FC<StudentProfileViewProps> = ({
  userId,
  onProfileUpdated
}) => {
  const [profile, setProfile] = useState<StudentUser | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; lastName?: string }>({});

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await studentService.getProfile(userId);
      setProfile(data);
      setFirstName(data.firstName);
      setLastName(data.lastName);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load student profile.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const validate = () => {
    const errors: { firstName?: string; lastName?: string } = {};
    if (!firstName.trim()) {
      errors.firstName = 'First name cannot be empty.';
    }
    if (!lastName.trim()) {
      errors.lastName = 'Last name cannot be empty.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updated = await studentService.updateProfile(userId, {
        firstName: firstName.trim(),
        lastName: lastName.trim()
      });
      setSuccessMessage('Your profile name has been successfully updated.');
      if (profile) {
        const newProfile: StudentUser = {
          ...profile,
          firstName: updated.firstName,
          lastName: updated.lastName
        };
        setProfile(newProfile);
        if (onProfileUpdated) {
          onProfileUpdated(newProfile);
        }
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to update profile information.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading your academic profile information..." />;
  }

  if (errorMessage && !profile) {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <Alert variant="error" title="Profile Retrieval Error">
          {errorMessage}
        </Alert>
        <div style={{ marginTop: '16px' }}>
          <Button variant="secondary" size="sm" onClick={loadProfile}>
            Retry Request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Student Academic Profile</h1>
          <p className="page-header__description">
            View your institutional records and update permitted account fields.
          </p>
        </div>
      </div>

      {successMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="success" onDismiss={() => setSuccessMessage(null)}>
            {successMessage}
          </Alert>
        </div>
      )}

      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Institutional Details (Read-Only) */}
      <div className="surface-card" style={{ marginBottom: '24px' }}>
        <h2 className="section-title">Institutional Enrollment Details</h2>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Official registrar records. Please contact administration for department or student ID corrections.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Student ID Number</div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
              <span className="code-identifier">{profile?.profile?.studentIdNumber || 'N/A'}</span>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Academic Department</div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>
              {profile?.profile?.departmentName || 'N/A'} ({profile?.profile?.departmentCode || 'N/A'})
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Academic Batch</div>
            <div style={{ fontWeight: 500 }}>{profile?.profile?.batch ? `Class of ${profile.profile.batch}` : 'Standard'}</div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Account Status</div>
            <div style={{ marginTop: '4px' }}>
              <UserStatusBadge status={profile?.status || 'ACTIVE'} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>University Email</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)' }}>
              {profile?.email}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Role Authorization</div>
            <div style={{ marginTop: '4px' }}>
              <Badge variant="info">Verified Student</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Editable Permitted Fields */}
      <div className="surface-card">
        <h2 className="section-title">Permitted Profile Information</h2>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          You may update your preferred first and last name as displayed to faculty members.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <FormField
              label="First Name"
              htmlFor="profile-first-name"
              required
              error={fieldErrors.firstName}
            >
              <TextInput
                id="profile-first-name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.firstName)}
              />
            </FormField>

            <FormField
              label="Last Name"
              htmlFor="profile-last-name"
              required
              error={fieldErrors.lastName}
            >
              <TextInput
                id="profile-last-name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.lastName)}
              />
            </FormField>
          </div>

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              leadingIcon={<CheckIcon size={16} />}
            >
              Save Profile Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
