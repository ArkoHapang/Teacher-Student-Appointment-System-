/**
 * Administrative Controller
 * Exposes server-side administrative operations strictly protected by RBAC (ADMIN only).
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { USER_STATUS } = require('../constants/roles');
const { AppError } = require('../middlewares/errorHandler');
const adminTeacherService = require('../services/adminTeacherService');
const adminAppointmentService = require('../services/adminAppointmentService');

const adminController = {
  /**
   * GET /api/v1/admin/appointments
   * Paginated list of appointments with filters, search, and sorting (Issue #38)
   */
  async listAppointments(req, res, next) {
    try {
      const result = await adminAppointmentService.listAppointments(req.query);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/admin/appointments/summary
   * Aggregated real-time metrics and counts across all appointments (Issue #38)
   */
  async getAppointmentSummary(req, res, next) {
    try {
      const summary = await adminAppointmentService.getAppointmentSummary();
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { summary }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/admin/appointments/:id
   * Detailed appointment view with student, teacher, slot, history, and feedback (Issue #38)
   */
  async getAppointment(req, res, next) {
    try {
      const appointment = await adminAppointmentService.getAppointmentById(req.params.id);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { appointment }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/admin/appointments/:id/history
   * Chronological status transition history (Issue #38 & #39)
   */
  async getAppointmentHistory(req, res, next) {
    try {
      const result = await adminAppointmentService.getAppointmentHistory(req.params.id);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/appointments/:id
   * Correct permitted appointment metadata (title, purpose) (Issue #39)
   */
  async updateAppointmentMetadata(req, res, next) {
    try {
      const appointment = await adminAppointmentService.updateAppointmentMetadata(req.params.id, req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Appointment metadata updated successfully.',
        data: { appointment }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/appointments/:id/status
   * Manage appointment status via approved lifecycle transitions (Issue #39)
   */
  async updateAppointmentStatus(req, res, next) {
    try {
      const result = await adminAppointmentService.updateAppointmentStatus(req.params.id, req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/appointments/:id/reschedule
   * Admin reschedule consultation with conflict detection and slot migration (Issue #39)
   */
  async rescheduleAppointment(req, res, next) {
    try {
      const result = await adminAppointmentService.rescheduleAppointment(req.params.id, req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/appointments/:id/approve
   */
  async approveAppointment(req, res, next) {
    try {
      const result = await adminAppointmentService.approveAppointment(req.params.id, req.user, req.body.notes, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/appointments/:id/reject
   */
  async rejectAppointment(req, res, next) {
    try {
      const result = await adminAppointmentService.rejectAppointment(req.params.id, req.user, req.body, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/appointments/:id/cancel
   */
  async cancelAppointment(req, res, next) {
    try {
      const result = await adminAppointmentService.cancelAppointment(req.params.id, req.user, req.body, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/appointments/:id/complete
   */
  async completeAppointment(req, res, next) {
    try {
      const result = await adminAppointmentService.completeAppointment(req.params.id, req.user, req.body, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },
  /**
   * GET /api/v1/admin/teachers
   * Paginated list of teachers with search, filters, and stats
   */
  async listTeachers(req, res, next) {
    try {
      const result = await adminTeacherService.listTeachers(req.query);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/admin/teachers/:id
   * Detailed teacher record with courses and metrics
   */
  async getTeacher(req, res, next) {
    try {
      const teacher = await adminTeacherService.getTeacherById(req.params.id);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { teacher }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/admin/teachers
   * Create a new teacher record (user + profile + optional courses)
   */
  async createTeacher(req, res, next) {
    try {
      const teacher = await adminTeacherService.createTeacher(req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: 'Teacher created successfully.',
        data: { teacher }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/teachers/:id
   * Update permitted teacher profile and account fields
   */
  async updateTeacher(req, res, next) {
    try {
      const teacher = await adminTeacherService.updateTeacher(req.params.id, req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Teacher profile updated successfully.',
        data: { teacher }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/teachers/:id/status
   * Activate, deactivate, or suspend teacher status
   */
  async updateTeacherStatus(req, res, next) {
    try {
      const result = await adminTeacherService.updateTeacherStatus(req.params.id, req.body, req.user, req.ip);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },
  /**
   * GET /api/v1/admin/users
   * List all system users with role names and status
   */
  async listUsers(req, res, next) {
    try {
      const users = await db.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.created_at,
                r.name as role_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         ORDER BY u.id ASC;`
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          total: users.length,
          users
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/users/:id/status
   * Modify a user's account status (ACTIVE, SUSPENDED, PENDING_APPROVAL)
   */
  async updateUserStatus(req, res, next) {
    try {
      const targetUserId = parseInt(req.params.id, 10);
      const { status } = req.body;

      if (!Object.values(USER_STATUS).includes(status)) {
        throw new AppError(
          `Invalid status. Must be one of: ${Object.values(USER_STATUS).join(', ')}`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS'
        );
      }

      const user = await db.queryOne('SELECT id, email, status FROM users WHERE id = ?;', [targetUserId]);
      if (!user) {
        throw new AppError('Target user not found.', HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND');
      }

      await db.execute('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;', [status, targetUserId]);

      // Record administrative audit action
      await db.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'UPDATE_USER_STATUS', 'USER', ?, ?, ?);`,
        [req.user.id, String(targetUserId), JSON.stringify({ previous: user.status, updated: status }), req.ip || '127.0.0.1']
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: `User status updated to ${status}.`,
        data: {
          userId: targetUserId,
          status
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/admin/teachers/:id/verify
   * Verify an academic faculty member
   */
  async verifyTeacher(req, res, next) {
    try {
      const teacherProfileId = parseInt(req.params.id, 10);
      const teacher = await db.queryOne('SELECT id, user_id, is_verified FROM teacher_profiles WHERE id = ?;', [teacherProfileId]);
      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      await db.execute('UPDATE teacher_profiles SET is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?;', [teacherProfileId]);
      // Also ensure the user account is ACTIVE
      await db.execute("UPDATE users SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [teacher.user_id]);

      await db.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'VERIFY_TEACHER', 'TEACHER_PROFILE', ?, ?, ?);`,
        [req.user.id, String(teacherProfileId), JSON.stringify({ verified: true }), req.ip || '127.0.0.1']
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Teacher profile successfully verified.',
        data: {
          teacherProfileId,
          isVerified: 1
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/admin/audit-logs
   * View administrative action ledger
   */
  async getAuditLogs(req, res, next) {
    try {
      const logs = await db.query(
        `SELECT a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.details, a.ip_address, a.created_at,
                u.email as actor_email, u.first_name, u.last_name
         FROM audit_logs a
         JOIN users u ON a.actor_id = u.id
         ORDER BY a.id DESC
         LIMIT 100;`
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { logs }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = adminController;
