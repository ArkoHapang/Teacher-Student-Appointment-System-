/**
 * Faculty / Teacher Profile View
 * Displays institutional faculty records and allows managing permitted fields
 * (firstName, lastName, designation, officeRoom, bio).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { teacherService } from '../../services/teacherService';
import { TeacherUser } from '../../types/teacher';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Textarea } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState } from '../../components/Feedback/Feedback';
import { UserStatusBadge, Badge } from '../../components/Badge/Badge';
import { CheckIcon } from '../../components/Icons/Icons';

interface TeacherProfileViewProps {
  userId: number;
  onProfileUpdated?: (user: TeacherUser) => void;
}

export const TeacherProfileView: React.FC<TeacherProfileViewProps> = ({
  userId,
  onProfileUpdated
}) => {
  const [profile, setProfile] = useState<TeacherUser | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [designation, setDesignation] = useState('');
  const [officeRoom, setOfficeRoom] = useState('');
  const [bio, setBio] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    firstName?: string;
    lastName?: string;
    designation?: string;
    officeRoom?: string;
  }>({});

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await teacherService.getProfile(userId);
      setProfile(data);
      setFirstName(data.firstName);
      setLastName(data.lastName);
      setDesignation(data.profile?.designation || '');
      setOfficeRoom(data.profile?.officeRoom || '');
      setBio(data.profile?.bio || '');
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load faculty profile.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const validate = () => {
    const errors: {
      firstName?: string;
      lastName?: string;
      designation?: string;
      officeRoom?: string;
    } = {};

    if (!firstName.trim()) {
      errors.firstName = 'First name cannot be empty.';
    }
    if (!lastName.trim()) {
      errors.lastName = 'Last name cannot be empty.';
    }
    if (!designation.trim()) {
      errors.designation = 'Academic designation is required (e.g. Associate Professor).';
    }
    if (!officeRoom.trim()) {
      errors.officeRoom = 'Office room location is required for student consultations.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting || !profile?.profile?.id) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updated = await teacherService.updateProfile(userId, profile.profile.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        designation: designation.trim(),
        officeRoom: officeRoom.trim(),
        bio: bio.trim()
      });

      setSuccessMessage('Your faculty credentials and contact details have been successfully updated.');

      const newProfile: TeacherUser = {
        ...profile,
        firstName: updated.firstName,
        lastName: updated.lastName,
        profile: profile.profile
          ? {
              ...profile.profile,
              designation: updated.designation,
              officeRoom: updated.officeRoom,
              bio: updated.bio
            }
          : undefined
      };

      setProfile(newProfile);
      if (onProfileUpdated) {
        onProfileUpdated(newProfile);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to update faculty profile information.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading your faculty profile records..." />;
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
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Faculty Profile & Office Hours</h1>
          <p className="page-header__description">
            View institutional departmental records and update permitted faculty consultation details.
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
        <h2 className="section-title">Institutional Faculty Records</h2>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Official university records. Contact academic affairs for department or verification status corrections.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Academic Department</div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
              {profile?.profile?.departmentName || 'N/A'} ({profile?.profile?.departmentCode || 'N/A'})
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Faculty Verification</div>
            <div style={{ marginTop: '4px' }}>
              {profile?.profile?.isVerified ? (
                <Badge variant="approved">Verified Faculty</Badge>
              ) : (
                <Badge variant="pending">Pending Verification</Badge>
              )}
            </div>
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
        </div>
      </div>

      {/* Permitted Profile & Consultation Details */}
      <div className="surface-card">
        <h2 className="section-title">Permitted Faculty Credentials</h2>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Update your academic title, office room, and student consultation guidance bio.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <FormField
              label="First Name"
              htmlFor="teacher-first-name"
              required
              error={fieldErrors.firstName}
            >
              <TextInput
                id="teacher-first-name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.firstName)}
              />
            </FormField>

            <FormField
              label="Last Name"
              htmlFor="teacher-last-name"
              required
              error={fieldErrors.lastName}
            >
              <TextInput
                id="teacher-last-name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.lastName)}
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
            <FormField
              label="Academic Designation"
              htmlFor="teacher-designation"
              required
              error={fieldErrors.designation}
              helperText="e.g. Professor, Associate Professor, Assistant Professor"
            >
              <TextInput
                id="teacher-designation"
                value={designation}
                onChange={e => setDesignation(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.designation)}
              />
            </FormField>

            <FormField
              label="Office Room Location"
              htmlFor="teacher-office-room"
              required
              error={fieldErrors.officeRoom}
              helperText="e.g. Engineering Hall 402, Science Annex 210"
            >
              <TextInput
                id="teacher-office-room"
                value={officeRoom}
                onChange={e => setOfficeRoom(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.officeRoom)}
              />
            </FormField>
          </div>

          <div style={{ marginTop: '12px' }}>
            <FormField
              label="Consultation Bio & Student Guidance"
              htmlFor="teacher-bio"
              helperText="Share your research interests, consultation focus areas, or preparation expectations for students."
            >
              <Textarea
                id="teacher-bio"
                value={bio}
                onChange={e => setBio(e.target.value)}
                disabled={isSubmitting}
                rows={4}
                placeholder="Briefly describe your office hour focus or specializations..."
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
