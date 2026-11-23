/**
 * Forgot Password Modal (Issue #47)
 * Allows users across all roles to request a single-use password recovery link.
 */

import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog/Dialog';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { authService } from '../../services/authService';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenResetPassword: () => void;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  onOpenResetPassword
}) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const res = await authService.forgotPassword(email.trim());
      setMessage(res.message);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to submit password recovery request.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Reset Your Account Password"
      size="sm"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenResetPassword();
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary-700)',
              fontSize: 'var(--font-size-xs)',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Have a reset token? Enter it here &rarr;
          </button>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
            Close
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Enter the email address associated with your university account. If an account exists,
          we will dispatch a password recovery link.
        </p>

        {message && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="success" onDismiss={() => setMessage(null)}>
              {message}
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

        <FormField
          label="Registered University Email"
          htmlFor="forgot-password-email"
          required
          helperText="e.g. alice.carter@student.university.edu"
        >
          <TextInput
            id="forgot-password-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
        </FormField>

        <div style={{ marginTop: '20px' }}>
          <Button
            type="submit"
            variant="primary"
            size="md"
            fullWidth
            isLoading={isLoading}
            disabled={!email.trim() || isLoading}
          >
            Send Password Reset Link
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
