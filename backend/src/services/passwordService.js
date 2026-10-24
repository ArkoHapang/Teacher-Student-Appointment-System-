/**
 * Password Hashing & Verification Service
 * Uses industry-standard bcrypt adaptive hashing with workload factor 10.
 * Enforces strong password complexity standards.
 */

const bcrypt = require('bcryptjs');

const BCRYPT_SALT_ROUNDS = 10;
const DUMMY_HASH = '$2b$10$wvnNLhxJGUPSd/4nZ7Xwk.sZVZ4Zxy5Awge.GZiY594x4miJEA55m';

const passwordService = {
  /**
   * Securely hash a plaintext password with adaptive bcrypt salt.
   * @param {string} plaintext - Plaintext password
   * @returns {Promise<string>} - Password hash
   */
  async hashPassword(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Password must be a non-empty string.');
    }
    return bcrypt.hash(plaintext, BCRYPT_SALT_ROUNDS);
  },

  /**
   * Compare a plaintext password against a stored bcrypt hash.
   * @param {string} plaintext - Plaintext password input
   * @param {string} hash - Stored bcrypt hash
   * @returns {Promise<boolean>} - True if matching, false otherwise
   */
  async verifyPassword(plaintext, hash) {
    if (!plaintext || !hash) {
      return false;
    }
    return bcrypt.compare(plaintext, hash);
  },

  /**
   * Perform constant-time comparison against a dummy hash to protect against
   * timing attacks when an email account is not found in the database.
   * @param {string} plaintext - Plaintext password candidate
   */
  async dummyVerify(plaintext) {
    await bcrypt.compare(plaintext || 'dummy_password', DUMMY_HASH);
    return false;
  },

  /**
   * Validates password strength policy:
   * - At least 8 characters
   * - Contains uppercase letter
   * - Contains lowercase letter
   * - Contains number
   * - Contains special symbol
   * @param {string} password
   * @returns {{ isValid: boolean, message?: string }}
   */
  validateComplexity(password) {
    if (!password || typeof password !== 'string') {
      return { isValid: false, message: 'Password is required and must be a string.' };
    }
    if (password.length < 8) {
      return { isValid: false, message: 'Password must be at least 8 characters in length.' };
    }
    if (password.length > 128) {
      return { isValid: false, message: 'Password cannot exceed 128 characters in length.' };
    }
    if (!/[A-Z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
    }
    if (!/[a-z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
    }
    if (!/[0-9]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one numeric digit (0-9).' };
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one special character.' };
    }
    return { isValid: true };
  }
};

module.exports = passwordService;
