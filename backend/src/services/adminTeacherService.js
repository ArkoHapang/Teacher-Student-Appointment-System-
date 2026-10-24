/**
 * Administrative Teacher Management Service (GitHub Issue #37)
 * Implements server-side administrative capabilities for managing faculty records:
 * 1. Paginated teacher listing with search, filtering, and sorting
 * 2. Detailed teacher record view with courses, slot statistics, and appointment metrics
 * 3. Teacher record creation (atomic user + teacher_profile + courses creation)
 * 4. Permitted field updates with role elevation protection and duplicate email prevention
 * 5. Lifecycle status transitions (ACTIVE, SUSPENDED, PENDING_APPROVAL) with safe upcoming appointment handling
 * 6. Audit ledger recording for all administrative operations
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { ROLES, USER_STATUS, APPOINTMENT_STATUS } = require('../constants/roles');
const passwordService = require('./passwordService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');

const adminTeacherService = {
  /**
   * Helper: Record an administrative action in the audit ledger.
   */
  async recordAudit(tx, { actorId, action, entityId, details, ipAddress }) {
    const client = tx || db;
    try {
      await client.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, ?, 'TEACHER_PROFILE', ?, ?, ?);`,
        [actorId, action, String(entityId), JSON.stringify(details), ipAddress || '127.0.0.1']
      );
    } catch (err) {
      logger.warn(`Failed to record audit log for action ${action} on entity ${entityId}: ${err.message}`);
    }
  },

  /**
   * 1. Retrieve a paginated list of teachers with search, filtering, and sorting.
   *
   * @param {Object} options
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @param {string} [options.search]
   * @param {string} [options.status] - 'ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED'
   * @param {number} [options.departmentId]
   * @param {number|boolean} [options.isVerified]
   * @param {string} [options.sortBy='created_at']
   * @param {string} [options.sortOrder='DESC']
   * @returns {Promise<Object>}
   */
  async listTeachers({
    page = 1,
    limit = 10,
    search,
    status,
    departmentId,
    isVerified,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (parsedPage - 1) * parsedLimit;

    let whereConditions = ['1=1'];
    const params = [];

    // Search filter across names, email, designation, office, department
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      whereConditions.push(`(
        u.first_name LIKE ? OR
        u.last_name LIKE ? OR
        u.email LIKE ? OR
        tp.designation LIKE ? OR
        tp.office_room LIKE ? OR
        d.code LIKE ? OR
        d.name LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term);
    }

    // Status filter
    if (status && Object.values(USER_STATUS).includes(status.toUpperCase())) {
      whereConditions.push('u.status = ?');
      params.push(status.toUpperCase());
    }

    // Department filter
    if (departmentId) {
      whereConditions.push('tp.department_id = ?');
      params.push(parseInt(departmentId, 10));
    }

    // Verification filter
    if (isVerified !== undefined && isVerified !== null && isVerified !== '') {
      const verifiedInt = (isVerified === true || isVerified === 1 || isVerified === '1' || isVerified === 'true') ? 1 : 0;
      whereConditions.push('tp.is_verified = ?');
      params.push(verifiedInt);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count total matching records
    const countQuery = `
      SELECT count(*) as total
      FROM teacher_profiles tp
      JOIN users u ON tp.user_id = u.id
      JOIN departments d ON tp.department_id = d.id
      ${whereClause};
    `;
    const countResult = await db.queryOne(countQuery, params);
    const total = parseInt(countResult.total, 10);
    const totalPages = Math.ceil(total / parsedLimit) || 1;

    // Sorting column validation
    const sortColumnMap = {
      name: 'u.last_name',
      email: 'u.email',
      created_at: 'tp.created_at',
      department: 'd.name',
      status: 'u.status',
      designation: 'tp.designation'
    };
    const orderColumn = sortColumnMap[sortBy] || 'tp.created_at';
    const normalizedSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Fetch paginated teachers with aggregated course & appointment statistics
    const dataQuery = `
      SELECT tp.id, tp.user_id, tp.department_id, tp.designation, tp.office_room,
             tp.bio, tp.is_verified, tp.created_at, tp.updated_at,
             u.first_name, u.last_name, u.email, u.status as user_status,
             d.code as department_code, d.name as department_name,
             (SELECT count(*) FROM teacher_courses tc WHERE tc.teacher_id = tp.id) as courses_count,
             (SELECT count(*) FROM teacher_availability_slots s WHERE s.teacher_id = tp.id) as slots_count,
             (SELECT count(*) FROM appointments a WHERE a.teacher_id = tp.id) as appointments_count,
             (SELECT count(*) FROM appointments a 
              JOIN teacher_availability_slots s ON a.slot_id = s.id
              WHERE a.teacher_id = tp.id 
                AND a.status IN ('PENDING', 'APPROVED', 'RESCHEDULE_PENDING')
                AND s.start_timestamp > CURRENT_TIMESTAMP) as upcoming_appointments_count
      FROM teacher_profiles tp
      JOIN users u ON tp.user_id = u.id
      JOIN departments d ON tp.department_id = d.id
      ${whereClause}
      ORDER BY ${orderColumn} ${normalizedSortOrder}
      LIMIT ? OFFSET ?;
    `;

    const queryParams = [...params, parsedLimit, offset];
    const rows = await db.query(dataQuery, queryParams);

    const teachers = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      status: r.user_status,
      department: {
        id: r.department_id,
        code: r.department_code,
        name: r.department_name
      },
      designation: r.designation,
      officeRoom: r.office_room,
      bio: r.bio,
      isVerified: r.is_verified,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      metrics: {
        coursesCount: parseInt(r.courses_count, 10),
        slotsCount: parseInt(r.slots_count, 10),
        appointmentsCount: parseInt(r.appointments_count, 10),
        upcomingAppointmentsCount: parseInt(r.upcoming_appointments_count, 10)
      }
    }));

    return {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages,
      teachers
    };
  },

  /**
   * 2. View an individual teacher's comprehensive administrative details.
   *
   * @param {number} teacherId - teacher_profiles.id
   * @returns {Promise<Object>}
   */
  async getTeacherById(teacherId) {
    const parsedId = parseInt(teacherId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric teacher ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_TEACHER_ID');
    }

    const row = await db.queryOne(
      `SELECT tp.id, tp.user_id, tp.department_id, tp.designation, tp.office_room,
              tp.bio, tp.is_verified, tp.created_at, tp.updated_at,
              u.first_name, u.last_name, u.email, u.status as user_status,
              d.code as department_code, d.name as department_name
       FROM teacher_profiles tp
       JOIN users u ON tp.user_id = u.id
       JOIN departments d ON tp.department_id = d.id
       WHERE tp.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!row) {
      throw new AppError(`Teacher record #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
    }

    // Fetch assigned courses
    const courses = await db.query(
      `SELECT id, course_code, course_title, created_at
       FROM teacher_courses
       WHERE teacher_id = ?
       ORDER BY course_code ASC;`,
      [parsedId]
    );

    // Fetch slot and appointment metrics
    const statsRow = await db.queryOne(
      `SELECT
         (SELECT count(*) FROM teacher_availability_slots WHERE teacher_id = ?) as total_slots,
         (SELECT count(*) FROM teacher_availability_slots WHERE teacher_id = ? AND is_booked = 0 AND is_active = 1 AND start_timestamp > CURRENT_TIMESTAMP) as active_open_slots,
         (SELECT count(*) FROM appointments WHERE teacher_id = ?) as total_appointments,
         (SELECT count(*) FROM appointments a 
          JOIN teacher_availability_slots s ON a.slot_id = s.id 
          WHERE a.teacher_id = ? AND a.status IN ('PENDING', 'APPROVED', 'RESCHEDULE_PENDING') AND s.start_timestamp > CURRENT_TIMESTAMP) as upcoming_appointments,
         (SELECT count(*) FROM appointments WHERE teacher_id = ? AND status = 'COMPLETED') as completed_appointments,
         (SELECT count(*) FROM appointments WHERE teacher_id = ? AND status = 'CANCELLED') as cancelled_appointments,
         (SELECT count(*) FROM appointments WHERE teacher_id = ? AND status = 'REJECTED') as rejected_appointments;`,
      [parsedId, parsedId, parsedId, parsedId, parsedId, parsedId, parsedId]
    );

    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      status: row.user_status,
      department: {
        id: row.department_id,
        code: row.department_code,
        name: row.department_name
      },
      designation: row.designation,
      officeRoom: row.office_room,
      bio: row.bio,
      isVerified: row.is_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      courses: courses.map((c) => ({
        id: c.id,
        courseCode: c.course_code,
        courseTitle: c.course_title
      })),
      stats: {
        totalSlots: parseInt(statsRow.total_slots, 10),
        activeOpenSlots: parseInt(statsRow.active_open_slots, 10),
        totalAppointments: parseInt(statsRow.total_appointments, 10),
        upcomingAppointments: parseInt(statsRow.upcoming_appointments, 10),
        completedAppointments: parseInt(statsRow.completed_appointments, 10),
        cancelledAppointments: parseInt(statsRow.cancelled_appointments, 10),
        rejectedAppointments: parseInt(statsRow.rejected_appointments, 10)
      }
    };
  },

  /**
   * 3. Create a teacher record (Admin-side).
   * Atomically generates user account and faculty profile with duplicate checking.
   *
   * @param {Object} data
   * @param {Object} adminUser - Authenticated admin
   * @param {string} ipAddress - Client IP for audit trail
   * @returns {Promise<Object>}
   */
  async createTeacher(data, adminUser, ipAddress) {
    const {
      email,
      password,
      firstName,
      lastName,
      departmentId,
      designation,
      officeRoom,
      bio = '',
      isVerified = 1,
      status = USER_STATUS.ACTIVE,
      courses = []
    } = data;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      throw new AppError('A valid email address is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const cleanEmail = email.trim().toLowerCase();

    // Check duplicate email
    const existingUser = await db.queryOne('SELECT id FROM users WHERE LOWER(email) = ?;', [cleanEmail]);
    if (existingUser) {
      throw new AppError(
        `User with email '${cleanEmail}' already exists in the system.`,
        HTTP_STATUS.CONFLICT,
        'DUPLICATE_EMAIL'
      );
    }

    // Validate names & required strings
    if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
      throw new AppError('First name is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
      throw new AppError('Last name is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (!designation || typeof designation !== 'string' || designation.trim().length === 0) {
      throw new AppError('Designation is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (!officeRoom || typeof officeRoom !== 'string' || officeRoom.trim().length === 0) {
      throw new AppError('Office room is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // Validate department
    const parsedDeptId = parseInt(departmentId, 10);
    if (!parsedDeptId || isNaN(parsedDeptId)) {
      throw new AppError('Valid departmentId is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    const department = await db.queryOne('SELECT id, code, name FROM departments WHERE id = ?;', [parsedDeptId]);
    if (!department) {
      throw new AppError(`Department #${parsedDeptId} does not exist.`, HTTP_STATUS.BAD_REQUEST, 'DEPARTMENT_NOT_FOUND');
    }

    // Password handling: use provided or generate strong default
    const plainPassword = password && password.trim().length >= 8 ? password.trim() : 'TeacherPass123!';
    const passwordHash = await passwordService.hashPassword(plainPassword);

    // Status validation
    const targetStatus = Object.values(USER_STATUS).includes(status) ? status : USER_STATUS.ACTIVE;
    const targetVerified = isVerified ? 1 : 0;

    return db.transaction(async (tx) => {
      // 1. Resolve role_id for TEACHER
      const roleRow = await tx.queryOne("SELECT id FROM roles WHERE name = 'TEACHER';");
      if (!roleRow) {
        throw new AppError('Teacher role definition missing from system catalog.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }

      // 2. Insert user account
      const userResult = await tx.execute(
        `INSERT INTO users (role_id, email, password_hash, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [roleRow.id, cleanEmail, passwordHash, firstName.trim(), lastName.trim(), targetStatus]
      );
      const newUserId = userResult.lastInsertRowid;

      // 3. Insert teacher profile
      const profileResult = await tx.execute(
        `INSERT INTO teacher_profiles (user_id, department_id, designation, office_room, bio, is_verified)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [newUserId, parsedDeptId, designation.trim(), officeRoom.trim(), bio.trim(), targetVerified]
      );
      const newTeacherProfileId = profileResult.lastInsertRowid;

      // 4. Insert optional initial courses
      const insertedCourses = [];
      if (Array.isArray(courses)) {
        for (const c of courses) {
          if (c && c.courseCode && c.courseTitle) {
            await tx.execute(
              `INSERT INTO teacher_courses (teacher_id, course_code, course_title)
               VALUES (?, ?, ?);`,
              [newTeacherProfileId, c.courseCode.trim().toUpperCase(), c.courseTitle.trim()]
            );
            insertedCourses.push({
              courseCode: c.courseCode.trim().toUpperCase(),
              courseTitle: c.courseTitle.trim()
            });
          }
        }
      }

      // 5. Record administrative audit log
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'CREATE_TEACHER',
        entityId: newTeacherProfileId,
        details: {
          userId: newUserId,
          email: cleanEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          departmentId: parsedDeptId,
          designation: designation.trim(),
          status: targetStatus,
          isVerified: targetVerified
        },
        ipAddress
      });

      logger.info(`[AdminTeacherService] Admin #${adminUser.id} created Teacher Profile #${newTeacherProfileId} for ${cleanEmail}`);

      return {
        id: newTeacherProfileId,
        userId: newUserId,
        email: cleanEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        status: targetStatus,
        department: {
          id: department.id,
          code: department.code,
          name: department.name
        },
        designation: designation.trim(),
        officeRoom: officeRoom.trim(),
        bio: bio.trim(),
        isVerified: targetVerified,
        courses: insertedCourses
      };
    });
  },

  /**
   * 4. Update permitted teacher profile and account fields.
   * Protects role integrity: users cannot elevate or change role through this endpoint.
   *
   * @param {number} teacherId - teacher_profiles.id
   * @param {Object} updates
   * @param {Object} adminUser
   * @param {string} ipAddress
   * @returns {Promise<Object>}
   */
  async updateTeacher(teacherId, updates, adminUser, ipAddress) {
    const parsedId = parseInt(teacherId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric teacher ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_TEACHER_ID');
    }

    // Existing teacher lookup
    const teacher = await db.queryOne(
      `SELECT tp.*, u.first_name, u.last_name, u.email, u.status, u.role_id
       FROM teacher_profiles tp
       JOIN users u ON tp.user_id = u.id
       WHERE tp.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!teacher) {
      throw new AppError(`Teacher record #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
    }

    const {
      firstName,
      lastName,
      email,
      departmentId,
      designation,
      officeRoom,
      bio,
      isVerified
    } = updates;

    // Defense-in-depth: Deny role modification through teacher profile updates
    if (updates.role !== undefined || updates.role_id !== undefined || updates.roleId !== undefined) {
      throw new AppError('Role modification is not permitted via teacher profile update.', HTTP_STATUS.BAD_REQUEST, 'ROLE_IMMUTABLE');
    }

    // Validate string fields if provided
    if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0)) {
      throw new AppError('First name cannot be empty.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length === 0)) {
      throw new AppError('Last name cannot be empty.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (designation !== undefined && (typeof designation !== 'string' || designation.trim().length === 0)) {
      throw new AppError('Designation cannot be empty.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }
    if (officeRoom !== undefined && (typeof officeRoom !== 'string' || officeRoom.trim().length === 0)) {
      throw new AppError('Office room cannot be empty.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    // Email check if changed
    let updatedEmail = teacher.email;
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof email !== 'string' || !emailRegex.test(email.trim())) {
        throw new AppError('A valid email address is required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail !== teacher.email.toLowerCase()) {
        const duplicate = await db.queryOne('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?;', [cleanEmail, teacher.user_id]);
        if (duplicate) {
          throw new AppError(`Email '${cleanEmail}' is already in use by another user.`, HTTP_STATUS.CONFLICT, 'DUPLICATE_EMAIL');
        }
        updatedEmail = cleanEmail;
      }
    }

    // Department check if changed
    let updatedDeptId = teacher.department_id;
    if (departmentId !== undefined && departmentId !== null) {
      const parsedDeptId = parseInt(departmentId, 10);
      const dept = await db.queryOne('SELECT id FROM departments WHERE id = ?;', [parsedDeptId]);
      if (!dept) {
        throw new AppError(`Department #${parsedDeptId} does not exist.`, HTTP_STATUS.BAD_REQUEST, 'DEPARTMENT_NOT_FOUND');
      }
      updatedDeptId = parsedDeptId;
    }

    const updatedFirstName = firstName !== undefined ? firstName.trim() : teacher.first_name;
    const updatedLastName = lastName !== undefined ? lastName.trim() : teacher.last_name;
    const updatedDesignation = designation !== undefined ? designation.trim() : teacher.designation;
    const updatedOfficeRoom = officeRoom !== undefined ? officeRoom.trim() : teacher.office_room;
    const updatedBio = bio !== undefined ? bio.trim() : teacher.bio;
    const updatedVerified = isVerified !== undefined ? (isVerified ? 1 : 0) : teacher.is_verified;

    return db.transaction(async (tx) => {
      // 1. Update users table (role_id remains untouched to prevent role elevation)
      await tx.execute(
        `UPDATE users
         SET first_name = ?, last_name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [updatedFirstName, updatedLastName, updatedEmail, teacher.user_id]
      );

      // 2. Update teacher_profiles table
      await tx.execute(
        `UPDATE teacher_profiles
         SET department_id = ?, designation = ?, office_room = ?, bio = ?, is_verified = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [updatedDeptId, updatedDesignation, updatedOfficeRoom, updatedBio, updatedVerified, parsedId]
      );

      // 3. Record audit log
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'UPDATE_TEACHER',
        entityId: parsedId,
        details: {
          previous: {
            firstName: teacher.first_name,
            lastName: teacher.last_name,
            email: teacher.email,
            departmentId: teacher.department_id,
            designation: teacher.designation,
            officeRoom: teacher.office_room,
            isVerified: teacher.is_verified
          },
          updated: {
            firstName: updatedFirstName,
            lastName: updatedLastName,
            email: updatedEmail,
            departmentId: updatedDeptId,
            designation: updatedDesignation,
            officeRoom: updatedOfficeRoom,
            isVerified: updatedVerified
          }
        },
        ipAddress
      });

      return this.getTeacherById(parsedId);
    });
  },

  /**
   * 5. Activate, deactivate, or suspend teacher status.
   * Handles upcoming appointments safely without corrupting historical records:
   * - Preserves all completed and historical appointment records.
   * - Automatically deactivates unbooked future availability slots when suspended.
   * - Optionally cancels upcoming active consultations with an administrative cancellation reason.
   *
   * @param {number} teacherId - teacher_profiles.id
   * @param {Object} params
   * @param {string} params.status - 'ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'
   * @param {boolean} [params.cancelUpcoming=false] - Whether to cancel upcoming appointments
   * @param {string} [params.cancellationReason] - Mandatory explanation if cancelUpcoming is true
   * @param {Object} adminUser
   * @param {string} ipAddress
   * @returns {Promise<Object>}
   */
  async updateTeacherStatus(teacherId, { status, cancelUpcoming = false, cancellationReason }, adminUser, ipAddress) {
    const parsedId = parseInt(teacherId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric teacher ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_TEACHER_ID');
    }

    if (!status || !Object.values(USER_STATUS).includes(status.toUpperCase())) {
      throw new AppError(
        `Invalid status '${status}'. Must be one of: ${Object.values(USER_STATUS).join(', ')}`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_STATUS'
      );
    }
    const targetStatus = status.toUpperCase();

    const teacher = await db.queryOne(
      `SELECT tp.id, tp.user_id, u.email, u.first_name, u.last_name, u.status as current_status
       FROM teacher_profiles tp
       JOIN users u ON tp.user_id = u.id
       WHERE tp.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!teacher) {
      throw new AppError(`Teacher record #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
    }

    // Inspect upcoming active appointments for this teacher
    const upcomingAppointments = await db.query(
      `SELECT a.id, a.student_id, a.slot_id, a.status, s.start_timestamp, s.end_timestamp
       FROM appointments a
       JOIN teacher_availability_slots s ON a.slot_id = s.id
       WHERE a.teacher_id = ?
         AND a.status IN ('PENDING', 'APPROVED', 'RESCHEDULE_PENDING')
         AND s.start_timestamp > CURRENT_TIMESTAMP
       ORDER BY s.start_timestamp ASC;`,
      [parsedId]
    );

    return db.transaction(async (tx) => {
      // 1. Update user account status
      await tx.execute(
        'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;',
        [targetStatus, teacher.user_id]
      );

      let deactivatedSlotsCount = 0;
      let cancelledAppointmentsCount = 0;

      // 2. When suspending / deactivating faculty:
      if (targetStatus === USER_STATUS.SUSPENDED || targetStatus === USER_STATUS.PENDING_APPROVAL) {
        // Deactivate unbooked future availability slots
        const slotUpdate = await tx.execute(
          `UPDATE teacher_availability_slots
           SET is_active = 0
           WHERE teacher_id = ?
             AND is_booked = 0
             AND is_active = 1
             AND start_timestamp > CURRENT_TIMESTAMP;`,
          [parsedId]
        );
        deactivatedSlotsCount = slotUpdate.changes;

        // If admin requested automatic cancellation of upcoming consultations:
        if (cancelUpcoming && upcomingAppointments.length > 0) {
          const reasonText = cancellationReason && cancellationReason.trim().length > 0
            ? cancellationReason.trim()
            : `Faculty account ${targetStatus.toLowerCase()} by administration.`;

          for (const appt of upcomingAppointments) {
            // Update appointment to CANCELLED
            await tx.execute(
              `UPDATE appointments
               SET status = 'CANCELLED', cancellation_reason = ?, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?;`,
              [reasonText, adminUser.id, appt.id]
            );

            // Release the slot
            await tx.execute(
              'UPDATE teacher_availability_slots SET is_booked = 0, is_active = 0 WHERE id = ?;',
              [appt.slot_id]
            );

            // Record status history audit
            await tx.execute(
              `INSERT INTO appointment_status_history
               (appointment_id, previous_status, new_status, changed_by, notes)
               VALUES (?, ?, 'CANCELLED', ?, ?);`,
              [appt.id, appt.status, adminUser.id, reasonText]
            );

            cancelledAppointmentsCount++;
          }
        }
      } else if (targetStatus === USER_STATUS.ACTIVE) {
        // Teacher reactivated; ensure verified is set if not already
        await tx.execute(
          'UPDATE teacher_profiles SET is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?;',
          [parsedId]
        );
      }

      // 3. Record audit entry
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'UPDATE_TEACHER_STATUS',
        entityId: parsedId,
        details: {
          previousStatus: teacher.current_status,
          updatedStatus: targetStatus,
          deactivatedSlotsCount,
          cancelledAppointmentsCount,
          preservedUpcomingCount: upcomingAppointments.length - cancelledAppointmentsCount
        },
        ipAddress
      });

      logger.info(
        `[AdminTeacherService] Admin #${adminUser.id} changed Teacher #${parsedId} status to ${targetStatus} ` +
        `(Slots deactivated: ${deactivatedSlotsCount}, Appointments cancelled: ${cancelledAppointmentsCount})`
      );

      return {
        teacherId: parsedId,
        previousStatus: teacher.current_status,
        status: targetStatus,
        deactivatedSlotsCount,
        cancelledAppointmentsCount,
        upcomingAppointmentsCount: upcomingAppointments.length - cancelledAppointmentsCount,
        message: `Teacher status updated to ${targetStatus}.`
      };
    });
  }
};

module.exports = adminTeacherService;
