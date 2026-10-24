/**
 * Server-Side Role-Based & Resource-Based Access Control Middleware
 * Enforces strict authorization policies:
 * 1. Role boundaries (Student, Teacher, Admin)
 * 2. Students cannot access administrative functions
 * 3. Teachers cannot manage other teachers
 * 4. Users cannot access other users' private records without permission
 * 5. Admin privileges enforced server-side
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const { ROLES } = require('../constants/roles');
const db = require('../config/database');

/**
 * Enforce that the authenticated user possesses at least one of the specified roles.
 * @param {...string} allowedRoles - e.g. ROLES.ADMIN, ROLES.TEACHER
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required before checking authorization.'
        }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied: role '${req.user.role}' is not authorized to access this resource.`
        }
      });
    }

    next();
  };
}

/**
 * Protect private records: Only the owner of the record OR an Admin can access or modify it.
 * @param {Function|string} getTargetUserId - Function extracting user_id or param name (default: 'id')
 */
function authorizeOwnerOrAdmin(getTargetUserId = 'id') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required before accessing private records.'
        }
      });
    }

    // Admins bypass ownership checks
    if (req.user.role === ROLES.ADMIN) {
      return next();
    }

    let targetUserId = null;
    if (typeof getTargetUserId === 'function') {
      targetUserId = getTargetUserId(req);
    } else {
      targetUserId = req.params[getTargetUserId];
    }

    const targetIdInt = parseInt(targetUserId, 10);
    if (isNaN(targetIdInt) || targetIdInt !== req.user.id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: "Access denied: you cannot access another user's private records without permission."
        }
      });
    }

    next();
  };
}

/**
 * Enforce rule: Teachers must not manage other teachers unless explicitly authorized.
 * Admins may manage any teacher.
 * A Teacher may only manage their own teacher profile or schedule.
 * Students cannot manage any teacher profile.
 */
function authorizeTeacherManagement() {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to perform teacher management.'
        }
      });
    }

    // 1. Admin can manage all teachers
    if (req.user.role === ROLES.ADMIN) {
      return next();
    }

    // 2. Students cannot manage any teachers
    if (req.user.role === ROLES.STUDENT) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: Students are not authorized to manage teacher profiles or schedules.'
        }
      });
    }

    // 3. Teachers can ONLY manage their own profile / slots
    if (req.user.role === ROLES.TEACHER) {
      const targetTeacherId = parseInt(req.params.id || req.params.teacherId, 10);
      if (!targetTeacherId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'A valid teacher ID parameter is required.'
          }
        });
      }

      // Check if target teacher profile belongs to req.user.id
      const teacherProfile = await db.queryOne(
        'SELECT id, user_id FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [targetTeacherId, targetTeacherId]
      );

      if (!teacherProfile || teacherProfile.user_id !== req.user.id) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied: Teachers cannot manage or modify other teachers.'
          }
        });
      }

      return next();
    }

    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: unauthorized.'
      }
    });
  };
}

module.exports = {
  authorizeRoles,
  authorizeOwnerOrAdmin,
  authorizeTeacherManagement
};
