/**
 * Student Consultation Feedback & Rating Service
 *
 * Implements:
 * 1. Submit feedback and rating for concluded consultations (COMPLETED status).
 * 2. Retrieve feedback for an appointment with strict role-based access control.
 * 3. Enforces single-review constraint per appointment (UNIQUE appointment_id).
 * 4. Dispatches transactional in-app notification to the assigned teacher.
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { ROLES, APPOINTMENT_STATUS } = require('../constants/roles');
const notificationService = require('./notificationService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');

const feedbackService = {
  /**
   * Submit consultation feedback for a completed appointment.
   *
   * @param {number|string} appointmentId
   * @param {Object} user - Authenticated user context (req.user)
   * @param {Object} payload
   * @param {number} payload.rating - Integer from 1 through 5
   * @param {string} [payload.comments] - Optional comments (max 1000 chars)
   * @returns {Promise<Object>} Created feedback record
   */
  async submitFeedback(appointmentId, user, { rating, comments } = {}) {
    // 1. Validate numeric appointment ID
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId) || parsedId <= 0) {
      throw new AppError(
        'A valid numeric appointment ID is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_APPOINTMENT_ID'
      );
    }

    // 2. Validate rating boundary and integer type
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError(
        'Rating must be an integer between 1 and 5.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_RATING'
      );
    }

    // 3. Validate optional comments
    let sanitizedComments = null;
    if (comments !== undefined && comments !== null) {
      if (typeof comments !== 'string') {
        throw new AppError(
          'Comments must be a string.',
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_COMMENTS'
        );
      }
      if (comments.length > 1000) {
        throw new AppError(
          'Comments cannot exceed 1000 characters.',
          HTTP_STATUS.BAD_REQUEST,
          'COMMENTS_TOO_LONG'
        );
      }
      sanitizedComments = comments.trim().length > 0 ? comments.trim() : null;
    }

    // 4. Enforce student role
    if (user.role !== ROLES.STUDENT) {
      throw new AppError(
        'Only students can submit consultation feedback.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    // 5. Resolve student profile from authenticated user ID (never trust client-supplied profile IDs)
    const studentProfile = await db.queryOne(
      'SELECT id, user_id FROM student_profiles WHERE user_id = ? LIMIT 1;',
      [user.id]
    );
    if (!studentProfile) {
      throw new AppError(
        'A valid student profile is required to submit feedback.',
        HTTP_STATUS.FORBIDDEN,
        'STUDENT_PROFILE_REQUIRED'
      );
    }

    // 6. Resolve appointment with participant references
    const appointment = await db.queryOne(
      `SELECT a.id, a.student_id, a.teacher_id, a.title, a.status,
              sp.user_id as student_user_id,
              tp.user_id as teacher_user_id
       FROM appointments a
       JOIN student_profiles sp ON a.student_id = sp.id
       JOIN teacher_profiles tp ON a.teacher_id = tp.id
       WHERE a.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!appointment) {
      throw new AppError(
        'The requested appointment does not exist.',
        HTTP_STATUS.NOT_FOUND,
        'APPOINTMENT_NOT_FOUND'
      );
    }

    // 7. Verify authenticated student owns the appointment
    if (appointment.student_id !== studentProfile.id || appointment.student_user_id !== user.id) {
      throw new AppError(
        'Access denied: you can only submit feedback for your own consultations.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    // 8. Verify appointment status is strictly COMPLETED
    if (appointment.status !== APPOINTMENT_STATUS.COMPLETED) {
      throw new AppError(
        `Feedback can only be submitted for completed consultations. Current status is '${appointment.status}'.`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_APPOINTMENT_STATUS'
      );
    }

    // 9. Pre-check for duplicate feedback
    const existingFeedback = await db.queryOne(
      'SELECT id FROM feedback_ratings WHERE appointment_id = ? LIMIT 1;',
      [parsedId]
    );
    if (existingFeedback) {
      throw new AppError(
        'Feedback has already been submitted for this consultation.',
        HTTP_STATUS.CONFLICT,
        'DUPLICATE_FEEDBACK'
      );
    }

    // 10. Execute atomic transaction: insert feedback and dispatch teacher notification
    return db.transaction(async (tx) => {
      // Re-verify uniqueness inside transaction lock to prevent race conditions
      const duplicateInTx = await tx.queryOne(
        'SELECT id FROM feedback_ratings WHERE appointment_id = ? LIMIT 1;',
        [parsedId]
      );
      if (duplicateInTx) {
        throw new AppError(
          'Feedback has already been submitted for this consultation.',
          HTTP_STATUS.CONFLICT,
          'DUPLICATE_FEEDBACK'
        );
      }

      let insertResult;
      try {
        insertResult = await tx.execute(
          `INSERT INTO feedback_ratings (appointment_id, student_id, teacher_id, rating, comments, created_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP);`,
          [parsedId, studentProfile.id, appointment.teacher_id, rating, sanitizedComments]
        );
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          throw new AppError(
            'Feedback has already been submitted for this consultation.',
            HTTP_STATUS.CONFLICT,
            'DUPLICATE_FEEDBACK'
          );
        }
        throw err;
      }

      const feedbackId = insertResult.lastInsertRowid;

      // Dispatch notification to the assigned teacher's user account (not teacher profile ID)
      const studentName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'A student';
      await notificationService.createNotification(tx, {
        recipientId: appointment.teacher_user_id,
        appointmentId: parsedId,
        title: 'Consultation Feedback Received',
        message: `${studentName} submitted feedback (${rating}/5 stars) for consultation '${appointment.title}'.`,
        type: notificationService.NOTIFICATION_TYPES.STATUS_UPDATE
      });

      logger.info(`[FeedbackService] Feedback #${feedbackId} submitted for Appointment #${parsedId} by User #${user.id}`);

      const createdRow = await tx.queryOne(
        'SELECT id, appointment_id, student_id, teacher_id, rating, comments, created_at FROM feedback_ratings WHERE id = ?;',
        [feedbackId]
      );

      return {
        id: createdRow ? createdRow.id : feedbackId,
        appointmentId: createdRow ? createdRow.appointment_id : parsedId,
        studentId: createdRow ? createdRow.student_id : studentProfile.id,
        teacherId: createdRow ? createdRow.teacher_id : appointment.teacher_id,
        rating: createdRow ? createdRow.rating : rating,
        comments: createdRow ? createdRow.comments : sanitizedComments,
        createdAt: createdRow ? createdRow.created_at : new Date().toISOString()
      };
    });
  },

  /**
   * Retrieve feedback for an appointment.
   * Access permitted to: Owning Student, Assigned Teacher, and Administrator.
   *
   * @param {number|string} appointmentId
   * @param {Object} user - Authenticated user context (req.user)
   * @returns {Promise<Object|null>} Feedback details or null if no feedback submitted yet
   */
  async getFeedbackByAppointmentId(appointmentId, user) {
    // 1. Validate numeric appointment ID
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId) || parsedId <= 0) {
      throw new AppError(
        'A valid numeric appointment ID is required.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_APPOINTMENT_ID'
      );
    }

    // 2. Resolve appointment participants
    const appointment = await db.queryOne(
      `SELECT a.id, a.student_id, a.teacher_id, a.status,
              sp.user_id as student_user_id,
              tp.user_id as teacher_user_id
       FROM appointments a
       JOIN student_profiles sp ON a.student_id = sp.id
       JOIN teacher_profiles tp ON a.teacher_id = tp.id
       WHERE a.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!appointment) {
      throw new AppError(
        'The requested appointment does not exist.',
        HTTP_STATUS.NOT_FOUND,
        'APPOINTMENT_NOT_FOUND'
      );
    }

    // 3. Authorization guard: Owning student, Assigned teacher, or Admin
    const isAdmin = user.role === ROLES.ADMIN;
    const isOwnerStudent = user.role === ROLES.STUDENT && appointment.student_user_id === user.id;
    const isAssignedTeacher = user.role === ROLES.TEACHER && appointment.teacher_user_id === user.id;

    if (!isAdmin && !isOwnerStudent && !isAssignedTeacher) {
      throw new AppError(
        'Access denied: you do not have permission to view feedback for this appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    // 4. Query feedback record
    const feedback = await db.queryOne(
      `SELECT id, appointment_id, student_id, teacher_id, rating, comments, created_at
       FROM feedback_ratings
       WHERE appointment_id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!feedback) {
      return null;
    }

    return {
      id: feedback.id,
      appointmentId: feedback.appointment_id,
      studentId: feedback.student_id,
      teacherId: feedback.teacher_id,
      rating: feedback.rating,
      comments: feedback.comments,
      createdAt: feedback.created_at
    };
  }
};

module.exports = feedbackService;
