/**
 * Unit & Integration Tests: Outbound Transactional Email Service (SMTP & Mock)
 * Validates delivery behavior across transports, error sanitization, token security,
 * and configuration validation.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../src/services/emailService');
const authService = require('../src/services/authService');
const db = require('../src/config/database');

describe('EmailService: Outbound Email Transport & Security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    emailService.clearOutbox();
    emailService.resetTransporter();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    emailService.clearOutbox();
    emailService.resetTransporter();
    process.env = { ...originalEnv };
  });

  describe('1. Mock Transport Behavior (Development / Test Default)', () => {
    it('should queue password reset email in outbox and preserve token for test consumption', async () => {
      process.env.EMAIL_TRANSPORT = 'mock';
      const token = 'test-pwd-token-1234567890abcdef12345678';
      const result = await emailService.sendPasswordReset('student@university.edu', token, 'Alice Doe');

      assert.equal(result.success, true);
      assert.equal(result.mode, 'mock');
      assert.equal(result.to, 'student@university.edu');
      assert.equal(result.token, token);
      assert.match(result.resetUrl, /reset-password\?token=/);

      const outbox = emailService.getOutbox();
      assert.equal(outbox.length, 1);
      assert.equal(outbox[0].type, 'PASSWORD_RESET');
      assert.equal(outbox[0].to, 'student@university.edu');

      const retrievedToken = emailService.getLatestToken('student@university.edu', 'PASSWORD_RESET');
      assert.equal(retrievedToken, token);
    });

    it('should queue student verification email with correct link and metadata', async () => {
      process.env.EMAIL_TRANSPORT = 'mock';
      const token = 'test-verify-token-abcdef1234567890abcdef';
      const result = await emailService.sendStudentVerification('bob@university.edu', token, 'Bob Smith');

      assert.equal(result.success, true);
      assert.equal(result.mode, 'mock');
      assert.equal(result.to, 'bob@university.edu');
      assert.equal(result.type, 'STUDENT_VERIFICATION');
      assert.match(result.verifyUrl, /verify-email\?token=/);

      const retrievedToken = emailService.getLatestToken('bob@university.edu', 'STUDENT_VERIFICATION');
      assert.equal(retrievedToken, token);
    });

    it('should queue faculty onboarding invitation with correct expiry metadata', async () => {
      process.env.EMAIL_TRANSPORT = 'mock';
      const token = 'test-invite-token-9876543210fedcba987654';
      const result = await emailService.sendTeacherInvitation('prof.carol@university.edu', token, 'Dr. Carol');

      assert.equal(result.success, true);
      assert.equal(result.mode, 'mock');
      assert.equal(result.to, 'prof.carol@university.edu');
      assert.equal(result.type, 'TEACHER_INVITATION');
      assert.match(result.onboardUrl, /onboard-teacher\?token=/);

      const retrievedToken = emailService.getLatestToken('prof.carol@university.edu', 'TEACHER_INVITATION');
      assert.equal(retrievedToken, token);
    });

    it('should correctly clear outbox on clearOutbox()', async () => {
      process.env.EMAIL_TRANSPORT = 'mock';
      await emailService.sendPasswordReset('user@university.edu', 'tok-1');
      assert.equal(emailService.getOutbox().length, 1);
      emailService.clearOutbox();
      assert.equal(emailService.getOutbox().length, 0);
      assert.equal(emailService.getLatestToken('user@university.edu'), null);
    });
  });

  describe('2. Missing SMTP Configuration Handling (Production Fail-Fast)', () => {
    it('should throw EMAIL_TRANSPORT_UNCONFIGURED in SMTP mode when SMTP_HOST is missing', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      delete process.env.SMTP_HOST;

      await assert.rejects(
        async () => {
          await emailService.sendPasswordReset('user@university.edu', 'some-token');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_TRANSPORT_UNCONFIGURED');
          assert.match(err.message, /Outbound SMTP transport is not configured/);
          return true;
        }
      );
    });

    it('should throw in production environment if SMTP_HOST is not provided', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EMAIL_TRANSPORT;
      delete process.env.SMTP_HOST;

      await assert.rejects(
        async () => {
          await emailService.sendStudentVerification('newstudent@university.edu', 'some-token');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_TRANSPORT_UNCONFIGURED');
          return true;
        }
      );
    });
  });

  describe('3. Successful Delivery via SMTP Transporter', () => {
    it('should successfully deliver message through configured SMTP transporter', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      process.env.SMTP_HOST = 'smtp.example.edu';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'api-user';
      process.env.SMTP_PASS = 'super-secret-password';

      let capturedMailOptions = null;
      const mockTransporter = {
        sendMail: async (options) => {
          capturedMailOptions = options;
          return {
            messageId: '<msg-id-12345@smtp.example.edu>',
            response: '250 2.0.0 OK'
          };
        }
      };

      emailService.setTransporter(mockTransporter);

      const token = 'live-smtp-delivery-token-777';
      const result = await emailService.sendPasswordReset('recipient@university.edu', token, 'Recipient Name');

      assert.equal(result.success, true);
      assert.equal(result.mode, 'smtp');
      assert.equal(result.messageId, '<msg-id-12345@smtp.example.edu>');
      assert.equal(capturedMailOptions.to, 'recipient@university.edu');
      assert.match(capturedMailOptions.subject, /Password Reset/);
      assert.match(capturedMailOptions.text, /recipient(%40|@)university\.edu/);
    });
  });

  describe('4. Provider Failure & Sensitive Credential Redaction', () => {
    it('should reject with sanitized EMAIL_DELIVERY_FAILURE on mail server network error', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      process.env.SMTP_HOST = 'smtp.broken-server.internal';

      const mockFailingTransporter = {
        sendMail: async () => {
          throw new Error('Connection timeout to smtp.broken-server.internal:587 after 10000ms');
        }
      };

      emailService.setTransporter(mockFailingTransporter);

      await assert.rejects(
        async () => {
          await emailService.sendTeacherInvitation('faculty@university.edu', 'invite-token');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_DELIVERY_FAILURE');
          assert.match(err.message, /Unable to deliver message via outbound mail provider/);
          assert.match(err.details, /Connection timeout/);
          return true;
        }
      );
    });

    it('should sanitize credentials if SMTP provider error message leaks password', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      process.env.SMTP_HOST = 'smtp.auth-leak.internal';

      const mockLeakingTransporter = {
        sendMail: async () => {
          throw new Error('Authentication rejected: user=admin password=SecretPassword123! token=sensitive-token-val');
        }
      };

      emailService.setTransporter(mockLeakingTransporter);

      await assert.rejects(
        async () => {
          await emailService.sendPasswordReset('target@university.edu', 'token');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_DELIVERY_FAILURE');
          // Verify that password and token were redacted!
          assert.doesNotMatch(err.details, /SecretPassword123!/);
          assert.doesNotMatch(err.details, /sensitive-token-val/);
          assert.match(err.details, /\[REDACTED\]/);
          return true;
        }
      );
    });
  });

  describe('5. Recipient Validation', () => {
    it('should reject invalid or missing recipient email', async () => {
      process.env.EMAIL_TRANSPORT = 'mock';

      await assert.rejects(
        async () => {
          await emailService.sendPasswordReset('', 'token');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_INVALID_RECIPIENT');
          return true;
        }
      );
    });
  });

  describe('6. Explicit Disabled Transport Mode (EMAIL_TRANSPORT=disabled)', () => {
    it('should correctly identify mode as disabled and isEnabled() as false', () => {
      process.env.EMAIL_TRANSPORT = 'disabled';
      assert.equal(emailService.getTransportMode(), 'disabled');
      assert.equal(emailService.isEnabled(), false);
    });

    it('should reject sendPasswordReset with EMAIL_DELIVERY_DISABLED and never queue in outbox', async () => {
      process.env.EMAIL_TRANSPORT = 'disabled';
      await assert.rejects(
        async () => {
          await emailService.sendPasswordReset('user@university.edu', 'tok-123');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_DELIVERY_DISABLED');
          assert.match(err.message, /Outbound transactional email service is not enabled/);
          return true;
        }
      );
      assert.equal(emailService.getOutbox().length, 0);
    });

    it('should reject sendStudentVerification and sendTeacherInvitation without queueing in outbox', async () => {
      process.env.EMAIL_TRANSPORT = 'disabled';
      await assert.rejects(
        async () => {
          await emailService.sendStudentVerification('student@university.edu', 'tok-456');
        },
        (err) => err.code === 'EMAIL_DELIVERY_DISABLED'
      );
      await assert.rejects(
        async () => {
          await emailService.sendTeacherInvitation('teacher@university.edu', 'tok-789');
        },
        (err) => err.code === 'EMAIL_DELIVERY_DISABLED'
      );
      assert.equal(emailService.getOutbox().length, 0);
    });

    it('should NOT fall back to SMTP even if SMTP_HOST and credentials exist in environment', async () => {
      process.env.EMAIL_TRANSPORT = 'disabled';
      process.env.SMTP_HOST = 'smtp.sendgrid.net';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      let transporterCalled = false;
      emailService.setTransporter({
        sendMail: async () => {
          transporterCalled = true;
          return { messageId: 'unexpected' };
        }
      });

      await assert.rejects(
        async () => {
          await emailService.sendPasswordReset('test@university.edu', 'token');
        },
        (err) => err.code === 'EMAIL_DELIVERY_DISABLED'
      );

      assert.equal(transporterCalled, false);
      assert.equal(emailService.getOutbox().length, 0);
    });

    it('should safely reject forgotPassword requests via authService without issuing tokens', async () => {
      process.env.EMAIL_TRANSPORT = 'disabled';

      const initialTokensCount = (await db.queryOne('SELECT COUNT(*) AS c FROM auth_tokens;'))?.c || 0;

      await assert.rejects(
        async () => {
          await authService.forgotPassword('sarah.jenkins@university.edu');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_SERVICE_DISABLED');
          assert.equal(err.statusCode, 503);
          assert.match(err.message, /Password recovery via email is currently unavailable/);
          return true;
        }
      );

      const postTokensCount = (await db.queryOne('SELECT COUNT(*) AS c FROM auth_tokens;'))?.c || 0;
      assert.equal(postTokensCount, initialTokensCount, 'No reset tokens must be created in disabled mode');
    });

    it('should preserve anti-enumeration safety on forgotPassword for non-existent emails', async () => {
      process.env.EMAIL_TRANSPORT = 'disabled';

      await assert.rejects(
        async () => {
          await authService.forgotPassword('nonexistent.ghost.user@university.edu');
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_SERVICE_DISABLED');
          assert.equal(err.statusCode, 503);
          assert.match(err.message, /Password recovery via email is currently unavailable/);
          return true;
        }
      );
    });
  });
});
