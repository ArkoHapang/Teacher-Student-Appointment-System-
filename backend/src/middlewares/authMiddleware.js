/**
 * Authentication Middleware
 * Validates incoming Bearer JWT tokens, verifies cryptographic integrity,
 * checks database revocation status, and attaches authenticated user identity to req.user.
 */

const tokenService = require('../services/tokenService');
const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { USER_STATUS } = require('../constants/roles');
const logger = require('../config/logger');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1].trim()) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Authorization header format must be: Bearer <token>'
          }
        });
      }
      token = parts[1].trim();
    } else if (req.headers.cookie) {
      const cookies = {};
      req.headers.cookie.split(';').forEach((c) => {
        const [k, ...v] = c.split('=');
        if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
      });
      token = cookies.token || cookies.jwt || cookies.access_token || null;
    }

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authorization header with Bearer token is required.'
        }
      });
    }

    // Anti-caching headers: prevent browsers from displaying cached protected pages upon back-navigation
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 3. Cryptographically verify JWT and expiration
    let decoded;
    try {
      decoded = tokenService.verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired. Please log in again.'
          }
        });
      }
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or forged authentication token.'
        }
      });
    }

    // 4. Check if token was revoked (e.g. via logout)
    if (decoded.jti) {
      const isRevoked = await tokenService.isTokenRevoked(decoded.jti);
      if (isRevoked) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Authentication token has been revoked. Please log in again.'
          }
        });
      }
    }

    // 5. Look up active user in database to ensure identity freshness & status
    const user = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.status, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1;`,
      [decoded.sub]
    );

    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'The user account associated with this token no longer exists.'
        }
      });
    }

    if (user.status === USER_STATUS.SUSPENDED) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended. Please contact the administrator.'
        }
      });
    }

    // 6. Attach authenticated identity to request context
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role_name,
      status: user.status
    };

    req.token = {
      raw: token,
      jti: decoded.jti
    };

    next();
  } catch (error) {
    logger.error(`[AuthMiddleware] Unexpected authentication error: ${error.message}`);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'INTERNAL_AUTH_ERROR',
        message: 'An unexpected error occurred during authentication.'
      }
    });
  }
}

module.exports = {
  authenticate
};
