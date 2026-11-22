/**
 * System Notification Service
 * Responsible for creating and managing in-app notifications.
 * Enforces transaction-boundary integration, permitted type validation,
 * and parameterized database execution.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');
const db = require('../config/database');
const eventService = require('./eventService');

const NOTIFICATION_TYPES = {
  BOOKING_REQUEST: 'BOOKING_REQUEST',
  STATUS_UPDATE: 'STATUS_UPDATE',
  RESCHEDULE_REQUEST: 'RESCHEDULE_REQUEST',
  NOTE_ADDED: 'NOTE_ADDED',
  REMINDER: 'REMINDER',
  SYSTEM_ALERT: 'SYSTEM_ALERT'
};

const notificationService = {
  NOTIFICATION_TYPES,

  /**
   * Insert a new notification record within the caller's active transaction or database handle.
   *
   * @param {Object} tx - Active database or transaction handle (must expose .execute(sql, params))
   * @param {Object} params
   * @param {number} params.recipientId - User ID of the recipient (references users.id)
   * @param {number|null} [params.appointmentId=null] - Associated appointment ID
   * @param {string} params.title - Notification title (max 200 chars)
   * @param {string} params.message - Notification message body
   * @param {string} params.type - Permitted notification type enum
   * @returns {Promise<Object>} Inserted notification metadata
   */
  async createNotification(tx, { recipientId, appointmentId = null, title, message, type }) {
    if (!tx || typeof tx.execute !== 'function') {
      throw new AppError(
        'A valid database execution context/transaction handle is required to create a notification.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        'DATABASE_TRANSACTION_REQUIRED'
      );
    }

    const parsedRecipientId = parseInt(recipientId, 10);
    if (!parsedRecipientId || isNaN(parsedRecipientId)) {
      throw new AppError(
        'A valid numeric recipientId is required to create a notification.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_NOTIFICATION_RECIPIENT'
      );
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new AppError(
        'Notification title is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_NOTIFICATION_TITLE'
      );
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new AppError(
        'Notification message is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_NOTIFICATION_MESSAGE'
      );
    }

    if (!type || !Object.values(NOTIFICATION_TYPES).includes(type)) {
      throw new AppError(
        `Invalid notification type '${type}'. Permitted types: ${Object.values(NOTIFICATION_TYPES).join(', ')}`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_NOTIFICATION_TYPE'
      );
    }

    const parsedAppointmentId = appointmentId !== null && appointmentId !== undefined
      ? parseInt(appointmentId, 10)
      : null;

    const trimmedTitle = title.trim().slice(0, 200);
    const trimmedMessage = message.trim();

    const result = await tx.execute(
      `INSERT INTO notifications (recipient_id, appointment_id, title, message, type, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP);`,
      [parsedRecipientId, parsedAppointmentId, trimmedTitle, trimmedMessage, type]
    );

    logger.debug(`[NotificationService] Notification #${result.lastInsertRowid} created for User #${parsedRecipientId} (${type})`);

    const notification = {
      id: result.lastInsertRowid,
      recipientId: parsedRecipientId,
      appointmentId: parsedAppointmentId,
      title: trimmedTitle,
      message: trimmedMessage,
      type,
      isRead: 0
    };

    if (tx && typeof tx.afterCommit === 'function') {
      tx.afterCommit(() => {
        eventService.sendToUser(parsedRecipientId, 'notification', notification, notification.id);
      });
    }

    return notification;
  },

  /**
   * Mark an individual notification as read.
   * Enforces that the notification belongs strictly to the authenticated user.
   *
   * @param {number|string} notificationId - Notification primary key ID
   * @param {number|string} userId - Authenticated user's ID from trusted server context
   * @param {Object} [tx=null] - Optional database handle
   * @returns {Promise<Object>} Updated notification metadata
   */
  async markAsRead(notificationId, userId, tx = null) {
    const dbHandle = tx || db;
    const parsedNotificationId = parseInt(notificationId, 10);
    const parsedUserId = parseInt(userId, 10);

    if (!parsedNotificationId || isNaN(parsedNotificationId) || parsedNotificationId <= 0) {
      throw new AppError(
        'A valid numeric notification ID is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_NOTIFICATION_ID'
      );
    }

    if (!parsedUserId || isNaN(parsedUserId) || parsedUserId <= 0) {
      throw new AppError(
        'A valid numeric user ID is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_USER_ID'
      );
    }

    const notification = await dbHandle.queryOne(
      `SELECT id, recipient_id, appointment_id, title, message, type, is_read, created_at
       FROM notifications
       WHERE id = ?;`,
      [parsedNotificationId]
    );

    if (!notification) {
      throw new AppError(
        'Notification not found.',
        HTTP_STATUS.NOT_FOUND,
        'NOTIFICATION_NOT_FOUND'
      );
    }

    if (notification.recipient_id !== parsedUserId) {
      throw new AppError(
        "Access denied: you cannot modify another user's notification.",
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    if (notification.is_read === 1 || notification.is_read === true) {
      return {
        id: notification.id,
        recipientId: notification.recipient_id,
        appointmentId: notification.appointment_id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        isRead: 1,
        createdAt: notification.created_at
      };
    }

    await dbHandle.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?;',
      [parsedNotificationId, parsedUserId]
    );

    logger.debug(`[NotificationService] Notification #${parsedNotificationId} marked as read by User #${parsedUserId}`);

    return {
      id: notification.id,
      recipientId: notification.recipient_id,
      appointmentId: notification.appointment_id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isRead: 1,
      createdAt: notification.created_at
    };
  },

  /**
   * Mark all unread notifications for a user as read.
   * Enforces recipient ownership directly within the parameterized SQL statement.
   *
   * @param {number|string} userId - Authenticated user's ID from trusted server context
   * @param {Object} [tx=null] - Optional database handle
   * @returns {Promise<{ recipientId: number, updatedCount: number }>}
   */
  async markAllAsRead(userId, tx = null) {
    const dbHandle = tx || db;
    const parsedUserId = parseInt(userId, 10);

    if (!parsedUserId || isNaN(parsedUserId) || parsedUserId <= 0) {
      throw new AppError(
        'A valid numeric user ID is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_USER_ID'
      );
    }

    const result = await dbHandle.execute(
      'UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0;',
      [parsedUserId]
    );

    const updatedCount = result && typeof result.changes === 'number' ? result.changes : 0;
    logger.debug(`[NotificationService] ${updatedCount} notifications marked as read for User #${parsedUserId}`);

    return {
      recipientId: parsedUserId,
      updatedCount
    };
  }
};

module.exports = notificationService;
