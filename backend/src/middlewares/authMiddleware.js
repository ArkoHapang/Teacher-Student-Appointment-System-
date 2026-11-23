/**
 * Authentication Middleware
 * Validates incoming Bearer JWT tokens, verifies cryptographic integrity,
 * checks database revocation status, and attaches authenticated user identity to req.user.
 */

const tokenService = require('../services/tokenService');
const db = require('../config/database');
const env = require('../config/env');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { USER_STATUS } = require('../constants/roles');
const logger = require('../config/logger');

/**
 * Resolve trusted origins for CSRF validation from configured settings.
 * Host and forwarded headers from incoming requests are NEVER trusted.
 * @param {import('express').Request} [req]
 * @returns {Set<string>}
 */
function getTrustedOrigins(req) {
  const trusted = new Set();

  const addIfValidOrigin = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === '*' || trimmed.includes('@')) return;
    try {
      const parsed = new URL(trimmed);
      // Origin must be http or https, without path (other than root '/'), query, or hash
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          (!parsed.pathname || parsed.pathname === '/') &&
          !parsed.search && !parsed.hash) {
        trusted.add(parsed.origin.toLowerCase());
      }
    } catch {
      // Ignore malformed URL
    }
  };

  const configured = env.cors.origin;
  const isProd = env.isProduction;
  // In production, do not treat default 'http://localhost:3000' as valid if CORS_ORIGIN was not explicitly set
  const isDefaultLocalhost = configured === 'http://localhost:3000' && !process.env.CORS_ORIGIN;

  if (configured && (!isProd || !isDefaultLocalhost)) {
    if (typeof configured === 'string') {
      configured.split(',').forEach(addIfValidOrigin);
    } else if (Array.isArray(configured)) {
      configured.forEach(addIfValidOrigin);
    }
  }

  // Safe explicit development origins (non-production only)
  if (!isProd) {
    trusted.add('http://localhost:3000');
    trusted.add('http://localhost:5000');
    trusted.add('http://127.0.0.1:3000');
    trusted.add('http://127.0.0.1:5000');
  }

  return trusted;
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    let authMechanism = null;

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
      authMechanism = 'bearer';
    } else if (req.headers.cookie) {
      const cookies = {};
      req.headers.cookie.split(';').forEach((c) => {
        const [k, ...v] = c.split('=');
        if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
      });
      token = cookies.token || cookies.jwt || cookies.access_token || null;
      if (token) {
        authMechanism = 'cookie';
      }
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

    // 5. Scoped CSRF protection for cookie-authenticated state-changing requests
    if (authMechanism === 'cookie') {
      const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
      if (isMutation) {
        // A. Reject cross-site requests via Fetch Metadata
        const secFetchSite = (req.headers['sec-fetch-site'] || '').toLowerCase();
        if (secFetchSite === 'cross-site') {
          logger.warn(`[AuthMiddleware] CSRF rejected: Sec-Fetch-Site is cross-site from IP ${req.clientIp || req.ip || 'unknown'}`);
          return res.status(HTTP_STATUS.FORBIDDEN).json({
            success: false,
            error: {
              code: 'CSRF_REJECTED',
              message: 'Cross-Site Request Forgery (CSRF) protection rejected this request.'
            }
          });
        }

        // B. Enforce trusted Origin and custom header for browser requests
        const hasBrowserIndicators = Boolean(
          req.headers.origin ||
          secFetchSite ||
          req.headers['sec-fetch-mode'] ||
          req.headers['x-requested-with'] ||
          req.headers['x-session-mode']
        );

        if (hasBrowserIndicators) {
          // Require custom header (XMLHttpRequest)
          const xRequestedWith = (req.headers['x-requested-with'] || '').toLowerCase();
          if (xRequestedWith !== 'xmlhttprequest') {
            logger.warn('[AuthMiddleware] CSRF rejected: Missing or invalid X-Requested-With header on cookie mutation');
            return res.status(HTTP_STATUS.FORBIDDEN).json({
              success: false,
              error: {
                code: 'CSRF_REJECTED',
                message: 'State-changing cookie request requires valid X-Requested-With: XMLHttpRequest header.'
              }
            });
          }

          // Require trusted Origin
          const rawOrigin = (req.headers.origin || '').trim();
          if (rawOrigin) {
            let parsedOrigin = null;
            try {
              const u = new URL(rawOrigin);
              if ((u.protocol === 'http:' || u.protocol === 'https:') &&
                  (!u.pathname || u.pathname === '/') &&
                  !u.search && !u.hash && !u.username && !u.password) {
                parsedOrigin = u.origin.toLowerCase();
              }
            } catch {
              parsedOrigin = null;
            }

            const trustedOrigins = getTrustedOrigins(req);
            if (!parsedOrigin || !trustedOrigins.has(parsedOrigin)) {
              logger.warn(`[AuthMiddleware] CSRF rejected: Untrusted origin '${rawOrigin}' on cookie mutation`);
              return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: {
                  code: 'CSRF_REJECTED',
                  message: 'Cross-Site Request Forgery (CSRF) validation failed: Origin is untrusted.'
                }
              });
            }
          } else {
            logger.warn('[AuthMiddleware] CSRF rejected: Missing Origin header on browser cookie mutation');
            return res.status(HTTP_STATUS.FORBIDDEN).json({
              success: false,
              error: {
                code: 'CSRF_REJECTED',
                message: 'State-changing browser request requires valid Origin header.'
              }
            });
          }
        }
      }
    }

    // 6. Look up active user in database to ensure identity freshness & status
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

    req.authMechanism = authMechanism;

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
  authenticate,
  getTrustedOrigins
};
