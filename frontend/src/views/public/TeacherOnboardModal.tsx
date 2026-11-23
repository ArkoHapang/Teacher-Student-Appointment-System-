/**
 * Faculty Credential Onboarding Modal (Issue #60)
 * Allows provisioned teachers to consume their onboarding invitation and establish permanent credentials.
 */

import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog/Dialog';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { authService } from '../../services/authService';

interface TeacherOnboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialToken?: string;
}

export const TeacherOnboardModal: React.FC<TeacherOnboardModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialToken = ''
}) => {
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !password || isLoading) return;

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify both fields.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters in length.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.onboardTeacher(token.trim(), password);
      setSuccessMessage(res.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Invitation token is invalid, expired, or already used.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Faculty Account Onboarding"
      size="sm"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
      }
    >
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Welcome to the faculty portal. Enter your onboarding invitation token and choose a secure password.
        </p>

        {successMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="success">{successMessage}</Alert>
          </div>
        )}

        {errorMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          </div>
        )}

        <FormField
          label="Invitation Token"
          htmlFor="teacher-invite-token"
          required
          helperText="Provided by your academic department administrator"
        >
          <TextInput
            id="teacher-invite-token"
            value={token}
            onChange={e => setToken(e.target.value)}
            disabled={isLoading || Boolean(successMessage)}
            autoFocus
          />
        </FormField>

        <FormField
          label="Set Your Password"
          htmlFor="teacher-new-password"
          required
          helperText="Min 8 characters, must include uppercase, lowercase, digit, and symbol"
        >
          <TextInput
            id="teacher-new-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isLoading || Boolean(successMessage)}
          />
        </FormField>

        <FormField
          label="Confirm Password"
          htmlFor="teacher-confirm-password"
          required
        >
          <TextInput
            id="teacher-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            disabled={isLoading || Boolean(successMessage)}
          />
        </FormField>

        <div style={{ marginTop: '20px' }}>
          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            isLoading={isLoading}
            disabled={!token.trim() || !password || isLoading || Boolean(successMessage)}
          >
            Establish Faculty Account
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
