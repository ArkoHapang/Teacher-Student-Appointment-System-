/**
 * Institutional Email & Notification Delivery Service
 * Provides production-grade transactional email delivery via SMTP (Nodemailer),
 * with a high-fidelity mock in-memory outbox for testing and development.
 * 
 * Supported Environment Variables:
 * - EMAIL_TRANSPORT: 'smtp' | 'mock' | 'disabled' (Defaults to 'mock' in test/development, 'smtp' in production)
 * - SMTP_HOST: Outbound SMTP server hostname (e.g., 'smtp.mailgun.org', 'smtp.sendgrid.net')
 * - SMTP_PORT: Outbound SMTP port (e.g., 587, 465, 25). Defaults to 587.
 * - SMTP_SECURE: 'true' | 'false' (Defaults to true if port is 465, otherwise false)
 * - SMTP_USER: SMTP authentication username / API key identifier
 * - SMTP_PASS: SMTP authentication password / API secret key
 * - SMTP_FROM / EMAIL_FROM: Default sender address (e.g., 'University Appointments <no-reply@university.edu>')
 */

const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// In-memory test outbox for automated test inspection and debugging
const outbox = [];

// Optional custom transporter override (e.g. for unit testing custom transports)
let customTransporter = null;

/**
 * Determine the active email transport mode.
 * @returns {'smtp' | 'mock' | 'disabled'}
 */
function getTransportMode() {
  const explicit = (process.env.EMAIL_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'disabled' || explicit === 'none' || explicit === 'off') return 'disabled';
  if (explicit === 'smtp') return 'smtp';
  if (explicit === 'mock' || explicit === 'memory' || explicit === 'test') return 'mock';

  // Environment-based defaulting
  if (process.env.NODE_ENV === 'test') return 'mock';
  if (process.env.NODE_ENV === 'production') return 'smtp';

  // In development, prefer SMTP if host is provided, otherwise mock
  if (process.env.SMTP_HOST) return 'smtp';
  return 'mock';
}

/**
 * Check whether transactional email delivery is enabled.
 * @returns {boolean}
 */
function isEnabled() {
  return getTransportMode() !== 'disabled';
}

/**
 * Retrieve sanitized SMTP configuration from environment variables.
 * @returns {Object}
 */
function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const from = (process.env.SMTP_FROM || process.env.EMAIL_FROM || 'University Appointment System <no-reply@university.edu>').trim();

  return { host, port, secure, user, pass, from };
}

/**
 * Create or return a Nodemailer transporter instance.
 * @param {Object} config
 * @returns {nodemailer.Transporter}
 */
function getTransporter(config) {
  if (customTransporter) {
    return customTransporter;
  }

  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: (config.user || config.pass) ? {
      user: config.user,
      pass: config.pass
    } : undefined
  };

  return nodemailer.createTransport(transportOptions);
}

/**
 * Sanitize error messages so that credentials or raw provider responses are never leaked.
 * @param {string} rawMessage
 * @returns {string}
 */
function sanitizeErrorMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') return 'Unknown transmission error';
  return rawMessage
    .replace(/(password|pass|secret|key|token)=([^\s;&]+)/gi, '$1=[REDACTED]')
    .replace(/(:\/\/)([^:@\s]+):([^@\s]+)@/g, '$1[REDACTED]:[REDACTED]@')
    .slice(0, 200);
}

/**
 * Core internal delivery engine using configured transport.
 * Enforces security, token redaction in logs, and credential shielding.
 */
async function dispatchEmail({ to, subject, body, html, type, token, actionUrl }) {
  const mode = getTransportMode();
  const recipient = (to || '').trim();

  if (!recipient) {
    const err = new Error('Email delivery failed: Recipient address is required.');
    err.code = 'EMAIL_INVALID_RECIPIENT';
    throw err;
  }

  const messageRecord = {
    to: recipient,
    type,
    subject,
    token,
    actionUrl,
    body,
    html: html || body,
    sentAt: new Date().toISOString()
  };

  if (mode === 'disabled') {
    logger.info(`[EmailService] Outbound email delivery is disabled. Suppressed ${type} email for ${recipient}`);
    const err = new Error('Email delivery is disabled: Outbound transactional email service is not enabled.');
    err.code = 'EMAIL_DELIVERY_DISABLED';
    throw err;
  }

  if (mode === 'mock') {
    outbox.push(messageRecord);
    // Crucial: avoid logging raw tokens in logs
    logger.info(`[EmailService] ${type} email dispatched (mock) for ${recipient}`);
    return {
      success: true,
      mode: 'mock',
      ...messageRecord
    };
  }

  // SMTP Mode
  const config = getSmtpConfig();
  if (!config.host) {
    logger.error(`[EmailService] SMTP delivery attempted to ${recipient} but SMTP_HOST is not configured.`);
    const err = new Error('Email delivery failed: Outbound SMTP transport is not configured.');
    err.code = 'EMAIL_TRANSPORT_UNCONFIGURED';
    throw err;
  }

  try {
    const transporter = getTransporter(config);
    const info = await transporter.sendMail({
      from: config.from,
      to: recipient,
      subject,
      text: body,
      html: html || body
    });

    outbox.push({
      ...messageRecord,
      messageId: info.messageId,
      mode: 'smtp'
    });

    // Crucial: avoid logging raw tokens in logs
    logger.info(`[EmailService] ${type} email dispatched (smtp) for ${recipient}`);
    return {
      success: true,
      mode: 'smtp',
      messageId: info.messageId,
      ...messageRecord
    };
  } catch (err) {
    const sanitizedMsg = sanitizeErrorMessage(err.message);
    logger.error(`[EmailService] SMTP transmission failed for ${recipient}: ${sanitizedMsg}`);
    const deliveryErr = new Error('Email delivery failed: Unable to deliver message via outbound mail provider.');
    deliveryErr.code = 'EMAIL_DELIVERY_FAILURE';
    deliveryErr.details = sanitizedMsg;
    throw deliveryErr;
  }
}

const emailService = {
  /**
   * Send a password reset recovery email with secure single-use token link.
   * @param {string} email - Recipient email
   * @param {string} token - Raw unhashed 32-byte recovery token
   * @param {string} [name='User'] - Recipient name
   */
  async sendPasswordReset(email, token, name = 'User') {
    const resetUrl = `/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const subject = 'University Appointment System: Password Reset Request';
    const body = `Hello ${name},\n\nA password reset request was submitted for your account. Please follow this link within 1 hour to set a new password:\n${resetUrl}\n\nIf you did not request this, you may safely ignore this message.`;

    const res = await dispatchEmail({
      to: email,
      subject,
      body,
      type: 'PASSWORD_RESET',
      token,
      actionUrl: resetUrl
    });

    return { ...res, resetUrl };
  },

  /**
   * Send student email verification link upon registration.
   * @param {string} email - Student institutional email
   * @param {string} token - Verification token
   * @param {string} [name='Student'] - Student name
   */
  async sendStudentVerification(email, token, name = 'Student') {
    const verifyUrl = `/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const subject = 'University Appointment System: Verify Your Student Email';
    const body = `Hello ${name},\n\nWelcome to the University Appointment System. Please verify your student email address by following this link:\n${verifyUrl}\n\nThis link will remain active for 24 hours.`;

    const res = await dispatchEmail({
      to: email,
      subject,
      body,
      type: 'STUDENT_VERIFICATION',
      token,
      actionUrl: verifyUrl
    });

    return { ...res, verifyUrl };
  },

  /**
   * Send faculty onboarding invitation with link to set password.
   * @param {string} email - Faculty email
   * @param {string} token - Onboarding invitation token
   * @param {string} [name='Faculty Member'] - Faculty name
   */
  async sendTeacherInvitation(email, token, name = 'Faculty Member') {
    const onboardUrl = `/onboard-teacher?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const subject = 'University Appointment System: Faculty Account Invitation';
    const body = `Dear ${name},\n\nAn academic administrator has provisioned your faculty account. Please set your permanent account password by following this link:\n${onboardUrl}\n\nThis invitation link will expire in 7 days.`;

    const res = await dispatchEmail({
      to: email,
      subject,
      body,
      type: 'TEACHER_INVITATION',
      token,
      actionUrl: onboardUrl
    });

    return { ...res, onboardUrl };
  },

  /**
   * Active transport mode accessor.
   */
  getTransportMode,

  /**
   * Check whether email delivery is enabled.
   */
  isEnabled,

  /**
   * Current SMTP configuration accessor.
   */
  getSmtpConfig,

  /**
   * Override transporter for testing (e.g. inject mock Nodemailer transporter).
   */
  setTransporter(transporter) {
    customTransporter = transporter;
  },

  /**
   * Reset custom transporter override.
   */
  resetTransporter() {
    customTransporter = null;
  },

  /**
   * Retrieve the latest sent token for a recipient and type (Used in automated tests).
   * @param {string} email
   * @param {string} type - 'PASSWORD_RESET' | 'STUDENT_VERIFICATION' | 'TEACHER_INVITATION'
   * @returns {string|null}
   */
  getLatestToken(email, type) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    for (let i = outbox.length - 1; i >= 0; i--) {
      const msg = outbox[i];
      if (msg.to.toLowerCase() === normalizedEmail && (!type || msg.type === type)) {
        return msg.token;
      }
    }
    return null;
  },

  /**
   * Get all messages in test outbox.
   */
  getOutbox() {
    return [...outbox];
  },

  /**
   * Clear outbox (for test teardowns).
   */
  clearOutbox() {
    outbox.length = 0;
  }
};

module.exports = emailService;
