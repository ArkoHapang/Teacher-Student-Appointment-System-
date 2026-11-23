/**
 * Verify Student Email Modal (Issue #62)
 * Validates registration verification token to activate student account.
 */

import React, { useState } from 'react';
import { Dialog } from '../../components/Dialog/Dialog';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput } from '../../components/Form/Form';
import { Alert } from '../../components/Alert/Alert';
import { authService } from '../../services/authService';

interface VerifyEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialToken?: string;
}

export const VerifyEmailModal: React.FC<VerifyEmailModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialToken = ''
}) => {
  const [token, setToken] = useState(initialToken);
  const [resendEmail, setResendEmail] = useState('');
  const [showResend, setShowResend] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.verifyEmail(token.trim());
      setSuccessMessage(res.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Verification token is invalid, expired, or has already been used.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim() || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.resendVerification(resendEmail.trim());
      setSuccessMessage(res.message);
      setShowResend(false);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to dispatch verification link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Verify Institutional Email"
      size="sm"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          Close
        </Button>
      }
    >
      <div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          Please verify your institutional student email to activate full consultation privileges.
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

        {!showResend ? (
          <form onSubmit={handleVerify}>
            <FormField
              label="Verification Token"
              htmlFor="verify-email-token"
              required
              helperText="Paste the token from your welcome email"
            >
              <TextInput
                id="verify-email-token"
                value={token}
                onChange={e => setToken(e.target.value)}
                disabled={isLoading || Boolean(successMessage)}
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
                disabled={!token.trim() || isLoading || Boolean(successMessage)}
              >
                Verify & Activate Account
              </Button>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowResend(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary-700)',
                  fontSize: 'var(--font-size-xs)',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                Need a new verification link? Click here.
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResend}>
            <FormField
              label="Student Email Address"
              htmlFor="resend-verify-email"
              required
              helperText="Enter your registered academic email"
            >
              <TextInput
                id="resend-verify-email"
                type="email"
                value={resendEmail}
                onChange={e => setResendEmail(e.target.value)}
                disabled={isLoading}
                autoFocus
              />
            </FormField>

            <div style={{ marginTop: '20px', display: 'flex', gap: '8px' }}>
              <Button
                type="submit"
                variant="primary"
                size="md"
                fullWidth
                isLoading={isLoading}
                disabled={!resendEmail.trim() || isLoading}
              >
                Resend Link
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setShowResend(false)}
                disabled={isLoading}
              >
                Back
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
};
