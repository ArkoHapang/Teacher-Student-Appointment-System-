/**
 * Authentication Business Logic Service
 * Orchestrates user authentication, password verification, audit logging,
 * and user profile resolution.
 */

const db = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');
const passwordService = require('./passwordService');
const tokenService = require('./tokenService');
const { AppError } = require('../middlewares/errorHandler');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { USER_STATUS } = require('../constants/roles');

const authService = {
  /**
   * Authenticate user credentials and return signed access token.
   * Employs constant-time dummy verification on nonexistent accounts to prevent
   * timing-based user enumeration attacks.
   * @param {string} email
   * @param {string} password
   * @param {string} ipAddress
   * @returns {Promise<Object>} - { user, token, expiresIn }
   */
  async login(email, password, ipAddress = '127.0.0.1') {
    const normalizedEmail = (email || '').trim().toLowerCase();

    // 1. Fetch user by email with role name
    const user = await db.queryOne(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.status,
              r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE LOWER(u.email) = ?
       LIMIT 1;`,
      [normalizedEmail]
    );

    // 2. Prevent user enumeration via timing attack
    if (!user) {
      await passwordService.dummyVerify(password);
      logger.warn(`[Auth] Failed login attempt: user '${normalizedEmail}' not found`, { ipAddress });
      throw new AppError(
        'Invalid email or password.',
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_CREDENTIALS'
      );
    }

    // 3. Verify password hash
    const isPasswordValid = await passwordService.verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      logger.warn(`[Auth] Failed login attempt: invalid password for '${normalizedEmail}'`, { ipAddress });
      throw new AppError(
        'Invalid email or password.',
        HTTP_STATUS.UNAUTHORIZED,
        'INVALID_CREDENTIALS'
      );
    }

    // 4. Check account status
    if (user.status === USER_STATUS.SUSPENDED) {
      logger.warn(`[Auth] Blocked login: user '${normalizedEmail}' is SUSPENDED`, { ipAddress });
      throw new AppError(
        'Account has been suspended. Please contact the administrator.',
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_SUSPENDED'
      );
    }

    if (user.status === USER_STATUS.PENDING_APPROVAL) {
      logger.warn(`[Auth] Blocked login: user '${normalizedEmail}' is PENDING_APPROVAL`, { ipAddress });
      throw new AppError(
        'Account approval is pending. Please wait for administrator verification.',
        HTTP_STATUS.FORBIDDEN,
        'ACCOUNT_PENDING_APPROVAL'
      );
    }

    // 5. Generate signed JWT access token
    const token = tokenService.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role_name,
      status: user.status
    });

    // 6. Record audit log
    try {
      await db.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'AUTH_LOGIN', 'USER', ?, ?, ?);`,
        [user.id, String(user.id), JSON.stringify({ role: user.role_name, email: user.email }), ipAddress]
      );
    } catch (auditErr) {
      logger.warn(`[Auth] Failed to write audit log on login: ${auditErr.message}`);
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role_name,
        status: user.status
      },
      token,
      expiresIn: env.jwt.expiresIn
    };
  },

  /**
   * Log out an active user session by revoking the submitted token.
   * @param {string} rawToken - Raw JWT string
   * @param {number} userId - Authenticated user id
   * @param {string} ipAddress - Client IP address
   */
  async logout(rawToken, userId, ipAddress = '127.0.0.1') {
    if (rawToken) {
      await tokenService.revokeToken(rawToken);
    }

    if (userId) {
      try {
        await db.execute(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES (?, 'AUTH_LOGOUT', 'USER', ?, ?, ?);`,
          [userId, String(userId), JSON.stringify({ message: 'User logged out' }), ipAddress]
        );
      } catch (auditErr) {
        logger.warn(`[Auth] Failed to record logout audit log: ${auditErr.message}`);
      }
    }

    return { message: 'Successfully logged out.' };
  },

  /**
   * Retrieve sanitized user record and associated role-specific profile.
   * Never exposes password hash.
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async getUserProfile(userId) {
    const user = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.created_at, u.updated_at,
              r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1;`,
      [userId]
    );

    if (!user) {
      throw new AppError('User not found.', HTTP_STATUS.NOT_FOUND, 'USER_NOT_FOUND');
    }

    let profile = null;
    if (user.role_name === 'STUDENT') {
      const sp = await db.queryOne(
        `SELECT sp.*, d.name as department_name, d.code as department_code
         FROM student_profiles sp
         LEFT JOIN departments d ON sp.department_id = d.id
         WHERE sp.user_id = ?;`,
        [userId]
      );
      if (sp) {
        profile = {
          ...sp,
          userId: sp.user_id,
          studentIdNumber: sp.student_id_number,
          departmentId: sp.department_id,
          departmentName: sp.department_name,
          departmentCode: sp.department_code,
          phoneNumber: sp.phone_number
        };
      }
    } else if (user.role_name === 'TEACHER') {
      const tp = await db.queryOne(
        `SELECT tp.*, d.name as department_name, d.code as department_code
         FROM teacher_profiles tp
         LEFT JOIN departments d ON tp.department_id = d.id
         WHERE tp.user_id = ?;`,
        [userId]
      );
      if (tp) {
        profile = {
          ...tp,
          userId: tp.user_id,
          officeRoom: tp.office_room,
          isVerified: tp.is_verified,
          departmentId: tp.department_id,
          departmentName: tp.department_name,
          departmentCode: tp.department_code
        };
      }
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role_name,
      status: user.status,
      createdAt: user.created_at,
      profile: profile || null
    };
  }
};

module.exports = authService;
