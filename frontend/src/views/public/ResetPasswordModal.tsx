/**
 * Reset Password Modal (Issue #47)
 * Consumes the single-use recovery token and establishes a new password.
 */

import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog/Dialog';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { authService } from '../../services/authService';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialToken?: string;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialToken = ''
}) => {
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !newPassword || isLoading) return;

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify both fields.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters in length.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.resetPassword(token.trim(), newPassword);
      setSuccessMessage(res.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to reset password. The token may be expired or invalid.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Set New Password"
      size="sm"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
      }
    >
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Enter the recovery token received in your password reset email, along with your new password.
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
          label="Password Reset Token"
          htmlFor="reset-token"
          required
          helperText="64-character hex token from recovery email"
        >
          <TextInput
            id="reset-token"
            value={token}
            onChange={e => setToken(e.target.value)}
            disabled={isLoading || Boolean(successMessage)}
            autoFocus
          />
        </FormField>

        <FormField
          label="New Password"
          htmlFor="reset-new-password"
          required
          helperText="Min 8 characters, must include uppercase, lowercase, digit, and symbol"
        >
          <TextInput
            id="reset-new-password"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            disabled={isLoading || Boolean(successMessage)}
          />
        </FormField>

        <FormField
          label="Confirm New Password"
          htmlFor="reset-confirm-password"
          required
        >
          <TextInput
            id="reset-confirm-password"
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
            disabled={!token.trim() || !newPassword || isLoading || Boolean(successMessage)}
          >
            Confirm Password Reset
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
