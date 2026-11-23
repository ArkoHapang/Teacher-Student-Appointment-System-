/**
 * Auth Token Service
 * Cryptographically secure single-use token lifecycle management.
 * Handles SHA-256 hash storage, expiration checks, and atomic token consumption.
 */

const crypto = require('crypto');
const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');

const TOKEN_TYPES = {
  PASSWORD_RESET: 'PASSWORD_RESET',
  STUDENT_VERIFICATION: 'STUDENT_VERIFICATION',
  TEACHER_INVITATION: 'TEACHER_INVITATION'
};

const authTokenService = {
  TOKEN_TYPES,

  /**
   * Hash a raw token string with SHA-256 for secure database storage.
   * @param {string} rawToken
   * @returns {string} 64-char hex string
   */
  hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
  },

  /**
   * Generate and persist a single-use token.
   * @param {number} userId - Target user ID
   * @param {string} type - Permitted token type
   * @param {number} expiryHours - Validity period in hours
   * @param {Object} [executor=db] - Database or transaction handle
   * @returns {Promise<{ rawToken: string, tokenHash: string, expiresAt: string }>}
   */
  async createToken(userId, type, expiryHours = 1, executor = db) {
    const numericUserId = Number(userId);
    if (!numericUserId || isNaN(numericUserId)) {
      throw new AppError('Valid numeric userId is required to generate auth token.', HTTP_STATUS.BAD_REQUEST);
    }

    if (!Object.values(TOKEN_TYPES).includes(type)) {
      throw new AppError(`Invalid auth token type '${type}'.`, HTTP_STATUS.BAD_REQUEST);
    }

    // Generate 32 bytes of cryptographically secure random entropy
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    // Compute ISO expiration timestamp in UTC
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    // Invalidate existing unused tokens of the same type for this user
    await executor.execute(
      `UPDATE auth_tokens
       SET used = 1, used_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND type = ? AND used = 0;`,
      [numericUserId, type]
    );

    // Insert new token hash
    await executor.execute(
      `INSERT INTO auth_tokens (user_id, token_hash, type, expires_at, used)
       VALUES (?, ?, ?, ?, 0);`,
      [numericUserId, tokenHash, type, expiresAt]
    );

    logger.debug(`[AuthTokenService] Issued ${type} token for User #${numericUserId} (Expires: ${expiresAt})`);

    return {
      rawToken,
      tokenHash,
      expiresAt
    };
  },

  /**
   * Validate and atomically consume a single-use token.
   * @param {string} rawToken - Plaintext token provided by client
   * @param {string} type - Expected token type
   * @param {Object} [executor=db] - Database or transaction handle
   * @returns {Promise<{ userId: number, tokenId: number, type: string }>}
   */
  async verifyAndConsumeToken(rawToken, type, executor = db) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new AppError('A valid authentication token is required.', HTTP_STATUS.BAD_REQUEST, 'TOKEN_REQUIRED');
    }

    const tokenHash = this.hashToken(rawToken.trim());

    const tokenRecord = await executor.queryOne(
      `SELECT id, user_id, type, expires_at, used
       FROM auth_tokens
       WHERE token_hash = ? AND type = ?
       LIMIT 1;`,
      [tokenHash, type]
    );

    if (!tokenRecord) {
      throw new AppError(
        'The provided token is invalid, unrecognized, or has already been used.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_TOKEN'
      );
    }

    if (tokenRecord.used) {
      throw new AppError(
        'This token has already been consumed and cannot be reused.',
        HTTP_STATUS.BAD_REQUEST,
        'TOKEN_ALREADY_USED'
      );
    }

    const rawExp = String(tokenRecord.expires_at).trim();
    const normalizedIso = rawExp.endsWith('Z') ? rawExp : rawExp.replace(' ', 'T') + 'Z';
    const expiresMs = new Date(normalizedIso).getTime();
    if (isNaN(expiresMs) || expiresMs <= Date.now()) {
      throw new AppError(
        'This token has expired. Please request a new link.',
        HTTP_STATUS.BAD_REQUEST,
        'TOKEN_EXPIRED'
      );
    }

    // Atomically mark token as consumed
    const updateResult = await executor.execute(
      `UPDATE auth_tokens
       SET used = 1, used_at = CURRENT_TIMESTAMP
       WHERE id = ? AND used = 0;`,
      [tokenRecord.id]
    );

    if (updateResult.changes === 0) {
      throw new AppError(
        'This token was concurrently consumed by another request.',
        HTTP_STATUS.CONFLICT,
        'TOKEN_ALREADY_USED'
      );
    }

    logger.debug(`[AuthTokenService] Consumed ${type} token #${tokenRecord.id} for User #${tokenRecord.user_id}`);

    return {
      userId: Number(tokenRecord.user_id),
      tokenId: Number(tokenRecord.id),
      type: tokenRecord.type
    };
  },

  /**
   * Invalidate all tokens for a user.
   * @param {number} userId
   * @param {string} [type]
   * @param {Object} [executor=db]
   */
  async revokeAllUserTokens(userId, type = null, executor = db) {
    const numericUserId = Number(userId);
    if (type) {
      return executor.execute(
        `UPDATE auth_tokens
         SET used = 1, used_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND type = ? AND used = 0;`,
        [numericUserId, type]
      );
    }
    return executor.execute(
      `UPDATE auth_tokens
       SET used = 1, used_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND used = 0;`,
      [numericUserId]
    );
  }
};

module.exports = authTokenService;
