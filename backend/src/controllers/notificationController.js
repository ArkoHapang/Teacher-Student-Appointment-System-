/**
 * Notification Controller
 *
 * Handles HTTP requests for real-time Server-Sent Events (SSE) notification streams.
 * Enforces server-side authentication context resolution, prevents recipient spoofing,
 * and integrates with the in-memory eventService.
 */

const eventService = require('../services/eventService');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const logger = require('../config/logger');

const notificationController = {
  /**
   * Establish an authenticated Server-Sent Events (SSE) notification stream.
   * Scoped strictly to the authenticated identity from req.user.id.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  async stream(req, res, next) {
    try {
      // 1. Authenticated user ID must be obtained exclusively from trusted server auth context
      const userId = req.user && req.user.id ? parseInt(req.user.id, 10) : null;

      if (!userId || isNaN(userId) || userId <= 0) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Valid authenticated user context is required to establish notification stream.'
          }
        });
      }

      // 2. Register HTTP response stream with eventService
      // eventService writes standard SSE headers (Content-Type: text/event-stream, Cache-Control: no-cache,
      // Connection: keep-alive, X-Accel-Buffering: no), flushes headers, transmits initial 'connected'
      // handshake frame, and registers idempotent cleanup listeners on response close/finish/error.
      eventService.registerConnection(userId, res);

      logger.info(`[NotificationController] User #${userId} (${req.user.role || 'USER'}) established notification SSE stream`);
    } catch (err) {
      logger.error(`[NotificationController] Failed to establish SSE stream for user: ${err.message}`, { error: err });
      if (!res.headersSent) {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: {
            code: 'STREAM_INITIALIZATION_FAILED',
            message: 'Failed to establish real-time notification stream.'
          }
        });
      }
    }
  }
};

module.exports = notificationController;
