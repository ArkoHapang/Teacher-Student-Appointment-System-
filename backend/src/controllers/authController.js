/**
 * Authentication Controller
 * Handles HTTP requests for login, logout, identity inspection, and token verification.
 */

const authService = require('../services/authService');
const { loginRateLimiter } = require('../middlewares/rateLimiter');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const env = require('../config/env');

const authController = {
  /**
   * POST /api/v1/auth/login
   * Public endpoint to authenticate user credentials
   */
  async login(req, res, next) {
    const { email, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = `${ip}:${(email || '').trim().toLowerCase()}`;

    try {
      const result = await authService.login(email, password, ip);
      // Reset failed attempt counter on success
      loginRateLimiter.recordSuccess(key);

      // Set secure HttpOnly cookie for browser sessions
      res.cookie('token', result.token, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
      });

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      // Record failure for brute-force tracking
      loginRateLimiter.recordFailure(key);
      next(error);
    }
  },

  /**
   * POST /api/v1/auth/logout
   * GET /api/v1/auth/logout
   * Protected endpoint to revoke current user access token, wipe client storage, and redirect
   */
  async logout(req, res, next) {
    try {
      const token = req.token ? req.token.raw : null;
      const userId = req.user ? req.user.id : null;
      const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

      const result = await authService.logout(token, userId, ip);

      // 1. Clear authentication cookies
      const cookieOptions = {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'strict',
        path: '/'
      };
      res.clearCookie('token', cookieOptions);
      res.clearCookie('jwt', cookieOptions);
      res.clearCookie('access_token', cookieOptions);

      // 2. Set anti-caching & storage wiping headers
      // Clear-Site-Data directs browsers to clear cached views, cookies, and local/session storage
      res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // 3. Handle browser navigation redirects vs JSON API response
      const wantsRedirect = req.query.redirect === 'true' ||
        (req.accepts && req.accepts('html') && !req.accepts('json'));

      if (wantsRedirect) {
        return res.redirect(302, '/login');
      }

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: {
          loggedOut: true,
          redirectTo: '/login',
          cleared: ['token', 'cookies', 'storage']
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/auth/me
   * Protected endpoint returning current user identity & role profile
   */
  async me(req, res, next) {
    try {
      const profile = await authService.getUserProfile(req.user.id);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: profile
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/auth/verify
   * Protected endpoint confirming valid authentication state
   */
  async verify(req, res) {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        valid: true,
        user: req.user
      }
    });
  }
};

module.exports = authController;
