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
  },

  /**
   * Public Student Self-Registration
   * Atomically generates user credentials and student profile within a single transaction.
   * Enforces strict role containment (STUDENT only) and ACTIVE status.
   *
   * @param {Object} data - Registration input
   * @param {string} ipAddress - Client IP for audit logging
   * @returns {Promise<Object>} - { user, profile, token, expiresIn }
   */
  async registerStudent(data, ipAddress = '127.0.0.1') {
    const {
      email,
      password,
      firstName,
      lastName,
      studentIdNumber,
      departmentId,
      batch,
      phoneNumber
    } = data || {};

    // 1. Email format and normalization
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      throw new AppError('A valid email address is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const cleanEmail = email.trim().toLowerCase();

    // 2. Name validation
    if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
      throw new AppError('First name is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (firstName.trim().length > 100) {
      throw new AppError('First name cannot exceed 100 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
      throw new AppError('Last name is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (lastName.trim().length > 100) {
      throw new AppError('Last name cannot exceed 100 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // 3. Student ID Number validation
    if (!studentIdNumber || typeof studentIdNumber !== 'string' || studentIdNumber.trim().length === 0) {
      throw new AppError('Student ID number is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const cleanStudentId = studentIdNumber.trim();
    if (cleanStudentId.length < 2 || cleanStudentId.length > 50) {
      throw new AppError('Student ID number must be between 2 and 50 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // 4. Department ID validation
    const parsedDeptId = parseInt(departmentId, 10);
    if (!parsedDeptId || isNaN(parsedDeptId) || parsedDeptId <= 0) {
      throw new AppError('Valid numeric departmentId is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // 5. Password complexity check
    if (!password || typeof password !== 'string') {
      throw new AppError('Password is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const complexity = passwordService.validateComplexity(password);
    if (!complexity.isValid) {
      throw new AppError(complexity.message || 'Password does not meet complexity standards.', HTTP_STATUS.BAD_REQUEST, 'WEAK_PASSWORD');
    }

    // 6. Secure bcrypt hashing (10 salt rounds)
    const passwordHash = await passwordService.hashPassword(password);

    // 7. Atomic transaction execution
    return db.transaction(async (tx) => {
      // Dynamic lookup of STUDENT role
      const roleRow = await tx.queryOne("SELECT id, name FROM roles WHERE name = 'STUDENT' LIMIT 1;");
      if (!roleRow) {
        throw new AppError('Student role definition missing from database catalog.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }

      // Check duplicate email
      const existingEmail = await tx.queryOne('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1;', [cleanEmail]);
      if (existingEmail) {
        throw new AppError(`Email address '${cleanEmail}' is already registered.`, HTTP_STATUS.CONFLICT, 'DUPLICATE_EMAIL');
      }

      // Check duplicate student ID
      const existingStudentId = await tx.queryOne('SELECT id FROM student_profiles WHERE student_id_number = ? LIMIT 1;', [cleanStudentId]);
      if (existingStudentId) {
        throw new AppError(`Student ID number '${cleanStudentId}' is already registered.`, HTTP_STATUS.CONFLICT, 'DUPLICATE_STUDENT_ID');
      }

      // Verify department exists
      const department = await tx.queryOne('SELECT id, code, name FROM departments WHERE id = ? LIMIT 1;', [parsedDeptId]);
      if (!department) {
        throw new AppError(`Department #${parsedDeptId} does not exist.`, HTTP_STATUS.BAD_REQUEST, 'DEPARTMENT_NOT_FOUND');
      }

      // Insert User record (strictly STUDENT role and ACTIVE status)
      const userResult = await tx.execute(
        `INSERT INTO users (role_id, email, password_hash, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [roleRow.id, cleanEmail, passwordHash, firstName.trim(), lastName.trim(), USER_STATUS.ACTIVE]
      );

      const userId = userResult.lastInsertRowid || (await tx.queryOne('SELECT id FROM users WHERE LOWER(email) = ?;', [cleanEmail])).id;

      // Insert Student Profile record
      const cleanPhone = phoneNumber && typeof phoneNumber === 'string' && phoneNumber.trim().length > 0
        ? phoneNumber.trim().slice(0, 25)
        : null;
      const cleanBatch = batch && typeof batch === 'string' && batch.trim().length > 0
        ? batch.trim().slice(0, 30)
        : null;

      const profileResult = await tx.execute(
        `INSERT INTO student_profiles (user_id, student_id_number, department_id, phone_number, batch)
         VALUES (?, ?, ?, ?, ?);`,
        [userId, cleanStudentId, department.id, cleanPhone, cleanBatch]
      );

      const profileId = profileResult.lastInsertRowid || (await tx.queryOne('SELECT id FROM student_profiles WHERE user_id = ?;', [userId])).id;

      // Record audit log
      try {
        await tx.execute(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES (?, 'AUTH_REGISTER', 'USER', ?, ?, ?);`,
          [
            userId,
            String(userId),
            JSON.stringify({
              role: 'STUDENT',
              email: cleanEmail,
              studentIdNumber: cleanStudentId,
              departmentCode: department.code
            }),
            ipAddress
          ]
        );
      } catch (auditErr) {
        logger.warn(`[Auth] Failed to write audit log on student registration: ${auditErr.message}`);
      }

      // Generate signed access token for immediate authentication
      const token = tokenService.generateAccessToken({
        id: userId,
        email: cleanEmail,
        role: 'STUDENT',
        status: USER_STATUS.ACTIVE
      });

      return {
        user: {
          id: userId,
          email: cleanEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'STUDENT',
          status: USER_STATUS.ACTIVE
        },
        profile: {
          id: profileId,
          userId,
          studentIdNumber: cleanStudentId,
          departmentId: department.id,
          departmentCode: department.code,
          departmentName: department.name,
          batch: cleanBatch,
          phoneNumber: cleanPhone
        },
        token,
        expiresIn: env.jwt.expiresIn
      };
    });
  }
};

module.exports = authService;
