/**
 * JSON Web Token (JWT) Lifecycle & Revocation Manager
 * Issues signed tokens, validates signatures & expirations, and coordinates
 * database-backed revocation (token blacklisting) upon logout.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const db = require('../config/database');
const logger = require('../config/logger');

const tokenService = {
  /**
   * Generate a signed JWT access token for an authenticated user.
   * Includes unique jti (JWT ID) to enable precise token revocation.
   * @param {Object} user - User record { id, email, role, status }
   * @param {Object} options - Custom options (e.g. override expiresIn for tests)
   * @returns {string} - Encoded JWT
   */
  generateAccessToken(user, options = {}) {
    const jti = crypto.randomUUID();
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      jti
    };

    return jwt.sign(payload, env.jwt.secret, {
      expiresIn: options.expiresIn || env.jwt.expiresIn,
      algorithm: 'HS256'
    });
  },

  /**
   * Verify token signature and expiration validity.
   * @param {string} token - Raw JWT string
   * @returns {Object} - Decoded token payload
   */
  verifyAccessToken(token) {
    return jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });
  },

  /**
   * Decode token without cryptographic signature verification (used for extracting jti on logout)
   * @param {string} token
   * @returns {Object|null}
   */
  decodeToken(token) {
    return jwt.decode(token);
  },

  /**
   * Revoke a token by saving its unique jti and expiration into revoked_tokens.
   * Ensures that once a user logs out, that specific token cannot be reused even
   * before its natural expiration time.
   * @param {string} token - Raw JWT string
   * @returns {Promise<boolean>}
   */
  async revokeToken(token) {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.jti) {
        return false;
      }

      const expDate = decoded.exp
        ? new Date(decoded.exp * 1000).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await db.execute(
        `INSERT OR IGNORE INTO revoked_tokens (token_id, user_id, expires_at)
         VALUES (?, ?, ?);`,
        [decoded.jti, decoded.sub || 0, expDate]
      );

      logger.debug(`[TokenService] Token revoked: jti=${decoded.jti}, userId=${decoded.sub}`);
      return true;
    } catch (err) {
      logger.error(`[TokenService] Failed to revoke token: ${err.message}`);
      return false;
    }
  },

  /**
   * Check whether a token's jti is present in the revoked_tokens ledger.
   * @param {string} jti - Token ID
   * @returns {Promise<boolean>} - True if revoked, false if active
   */
  async isTokenRevoked(jti) {
    if (!jti) return false;
    const record = await db.queryOne(
      'SELECT id FROM revoked_tokens WHERE token_id = ? LIMIT 1;',
      [jti]
    );
    return !!record;
  },

  /**
   * Purge expired entries from revoked_tokens to maintain database efficiency.
   * @returns {Promise<number>} - Count of deleted rows
   */
  async cleanupRevokedTokens() {
    const nowIso = new Date().toISOString();
    const result = await db.execute(
      'DELETE FROM revoked_tokens WHERE expires_at < ?;',
      [nowIso]
    );
    return result.changes || 0;
  }
};

module.exports = tokenService;
