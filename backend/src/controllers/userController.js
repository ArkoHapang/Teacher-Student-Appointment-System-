/**
 * User Management & Private Records Controller
 * Handles user profile retrieval and updates with strict resource ownership validation.
 */

const authService = require('../services/authService');
const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { AppError } = require('../middlewares/errorHandler');

const userController = {
  /**
   * GET /api/v1/users/:id
   * Private user record retrieval:
   * Rule: Users must not access another user's private records without permission.
   * Only the owner OR an Admin can access.
   */
  async getProfile(req, res, next) {
    try {
      const targetUserId = parseInt(req.params.id, 10);
      const profile = await authService.getUserProfile(targetUserId);

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: profile
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/users/:id
   * Update personal profile information:
   * Only the owner OR an Admin can update.
   */
  async updateProfile(req, res, next) {
    try {
      const targetUserId = parseInt(req.params.id, 10);
      const { firstName, lastName } = req.body || {};

      if (firstName === undefined && lastName === undefined) {
        throw new AppError('At least one field (firstName or lastName) is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0 || firstName.trim().length > 100)) {
        throw new AppError('firstName must be a non-empty string under 100 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length === 0 || lastName.trim().length > 100)) {
        throw new AppError('lastName must be a non-empty string under 100 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      const user = await db.queryOne('SELECT id, first_name, last_name FROM users WHERE id = ?;', [targetUserId]);
      if (!user) {
        throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND');
      }

      const updatedFirstName = firstName !== undefined ? firstName.trim() : user.first_name;
      const updatedLastName = lastName !== undefined ? lastName.trim() : user.last_name;

      await db.execute(
        'UPDATE users SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;',
        [updatedFirstName, updatedLastName, targetUserId]
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Profile successfully updated.',
        data: {
          id: targetUserId,
          firstName: updatedFirstName,
          lastName: updatedLastName
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/users/:id/notifications
   * Retrieve notification alerts for user
   */
  async getNotifications(req, res, next) {
    try {
      const targetUserId = parseInt(req.params.id, 10);
      const notifications = await db.query(
        `SELECT id, 
                recipient_id AS recipientId, 
                appointment_id AS appointmentId, 
                title, 
                message, 
                type, 
                is_read AS isRead, 
                created_at AS createdAt 
         FROM notifications 
         WHERE recipient_id = ? 
         ORDER BY created_at DESC;`,
        [targetUserId]
      );
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          total: notifications.length,
          notifications
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = userController;
