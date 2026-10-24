/**
 * Administrative Appointment Management & Monitoring Service (GitHub Issues #38 & #39)
 *
 * Implements:
 * PART A (Issue #38): Administrative Monitoring of Appointments
 * - Paginated appointment listing with pagination metadata
 * - Multi-criteria filters: status, teacher, student, department, date range (startDate, endDate)
 * - Search by appointment identifier (#ID or numeric) or keyword (name, email, student ID, title)
 * - Detailed appointment view with student, teacher, slot, status history, and feedback
 * - Aggregated appointment metrics and real-time database summary counts
 * - Consistent sorting (created_at, date, status, title, student_name, teacher_name)
 *
 * PART B (Issue #39): Administrative Record Management
 * - Permitted metadata corrections (title, purpose) with validation
 * - Enforce appointment lifecycle state machine: prevent arbitrary status bypasses
 * - Approved status workflow transitions (PENDING -> APPROVED, REJECTED, CANCELLED; APPROVED -> COMPLETED, CANCELLED)
 * - Rescheduling with conflict detection and atomic slot migration
 * - Complete history preservation: immutable status history and audit logging
 * - Never permanently delete appointment records
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { ROLES, APPOINTMENT_STATUS } = require('../constants/roles');
const { ALLOWED_TRANSITIONS, isValidTransition, isTerminalStatus } = require('../constants/appointmentLifecycle');
const slotService = require('./slotService');
const conflictService = require('./conflictService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');

const adminAppointmentService = {
  /**
   * Helper: Record an administrative action in the audit ledger.
   */
  async recordAudit(tx, { actorId, action, entityId, details, ipAddress }) {
    const client = tx || db;
    try {
      await client.execute(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, ?, 'APPOINTMENT', ?, ?, ?);`,
        [actorId, action, String(entityId), JSON.stringify(details), ipAddress || '127.0.0.1']
      );
    } catch (err) {
      logger.warn(`Failed to record audit log for action ${action} on appointment ${entityId}: ${err.message}`);
    }
  },

  /**
   * PART A: Paginated appointment listing with search, filtering, and sorting.
   *
   * @param {Object} options
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @param {string} [options.status]
   * @param {number} [options.teacherId]
   * @param {number} [options.studentId]
   * @param {number} [options.departmentId]
   * @param {string} [options.startDate]
   * @param {string} [options.endDate]
   * @param {string} [options.search]
   * @param {string} [options.sortBy='created_at']
   * @param {string} [options.sortOrder='DESC']
   * @returns {Promise<Object>}
   */
  async listAppointments({
    page = 1,
    limit = 10,
    status,
    teacherId,
    studentId,
    departmentId,
    startDate,
    endDate,
    search,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (parsedPage - 1) * parsedLimit;

    let whereConditions = ['1=1'];
    const params = [];

    // Filter by status (single status or comma-separated list)
    if (status && typeof status === 'string' && status.trim().length > 0) {
      const statuses = status
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => Object.values(APPOINTMENT_STATUS).includes(s));

      if (statuses.length === 1) {
        whereConditions.push('a.status = ?');
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        const placeholders = statuses.map(() => '?').join(', ');
        whereConditions.push(`a.status IN (${placeholders})`);
        params.push(...statuses);
      }
    }

    // Filter by teacher (matches teacher_profile.id or users.id)
    if (teacherId !== undefined && teacherId !== null && teacherId !== '') {
      const parsedTeacherId = parseInt(teacherId, 10);
      if (!isNaN(parsedTeacherId)) {
        whereConditions.push('(a.teacher_id = ? OR tp.user_id = ?)');
        params.push(parsedTeacherId, parsedTeacherId);
      }
    }

    // Filter by student (matches student_profile.id or users.id)
    if (studentId !== undefined && studentId !== null && studentId !== '') {
      const parsedStudentId = parseInt(studentId, 10);
      if (!isNaN(parsedStudentId)) {
        whereConditions.push('(a.student_id = ? OR sp.user_id = ?)');
        params.push(parsedStudentId, parsedStudentId);
      }
    }

    // Filter by department (matches student or teacher department)
    if (departmentId !== undefined && departmentId !== null && departmentId !== '') {
      const parsedDeptId = parseInt(departmentId, 10);
      if (!isNaN(parsedDeptId)) {
        whereConditions.push('(sp.department_id = ? OR tp.department_id = ?)');
        params.push(parsedDeptId, parsedDeptId);
      }
    }

    // Date range filters (slot_date or start_timestamp)
    if (startDate && typeof startDate === 'string' && startDate.trim().length > 0) {
      const cleanStart = startDate.trim();
      if (cleanStart.length === 10) {
        whereConditions.push('s.slot_date >= ?');
        params.push(cleanStart);
      } else {
        whereConditions.push('s.start_timestamp >= ?');
        params.push(cleanStart);
      }
    }

    if (endDate && typeof endDate === 'string' && endDate.trim().length > 0) {
      const cleanEnd = endDate.trim();
      if (cleanEnd.length === 10) {
        whereConditions.push('s.slot_date <= ?');
        params.push(cleanEnd);
      } else {
        whereConditions.push('s.start_timestamp <= ?');
        params.push(cleanEnd);
      }
    }

    // Search filter across ID, names, emails, student number, title, purpose
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const cleanSearch = search.trim();
      const idMatch = cleanSearch.replace(/^#/, '');
      const isNumeric = /^\d+$/.test(idMatch);

      if (isNumeric) {
        const numId = parseInt(idMatch, 10);
        const term = `%${cleanSearch}%`;
        whereConditions.push(`(
          a.id = ? OR
          a.title LIKE ? OR
          a.purpose LIKE ? OR
          stu_u.first_name LIKE ? OR
          stu_u.last_name LIKE ? OR
          stu_u.email LIKE ? OR
          sp.student_id_number LIKE ? OR
          tch_u.first_name LIKE ? OR
          tch_u.last_name LIKE ? OR
          tch_u.email LIKE ?
        )`);
        params.push(numId, term, term, term, term, term, term, term, term, term);
      } else {
        const term = `%${cleanSearch}%`;
        whereConditions.push(`(
          a.title LIKE ? OR
          a.purpose LIKE ? OR
          stu_u.first_name LIKE ? OR
          stu_u.last_name LIKE ? OR
          stu_u.email LIKE ? OR
          sp.student_id_number LIKE ? OR
          tch_u.first_name LIKE ? OR
          tch_u.last_name LIKE ? OR
          tch_u.email LIKE ?
        )`);
        params.push(term, term, term, term, term, term, term, term, term);
      }
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count query
    const countQuery = `
      SELECT count(*) as total
      FROM appointments a
      JOIN student_profiles sp ON a.student_id = sp.id
      JOIN users stu_u ON sp.user_id = stu_u.id
      JOIN teacher_profiles tp ON a.teacher_id = tp.id
      JOIN users tch_u ON tp.user_id = tch_u.id
      JOIN teacher_availability_slots s ON a.slot_id = s.id
      ${whereClause};
    `;

    const countResult = await db.queryOne(countQuery, params);
    const total = parseInt(countResult.total, 10);
    const totalPages = Math.ceil(total / parsedLimit) || 1;

    // Sorting column mapping
    const sortColumnMap = {
      created_at: 'a.created_at',
      date: 's.start_timestamp',
      slot_date: 's.start_timestamp',
      status: 'a.status',
      title: 'a.title',
      student_name: 'stu_u.last_name',
      teacher_name: 'tch_u.last_name'
    };
    const orderColumn = sortColumnMap[sortBy] || 'a.created_at';
    const normalizedSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Data query
    const dataQuery = `
      SELECT a.id, a.student_id, a.teacher_id, a.slot_id, a.title, a.purpose,
             a.status, a.cancellation_reason, a.cancelled_by, a.created_at, a.updated_at,
             sp.user_id as student_user_id, sp.student_id_number,
             stu_u.first_name as student_first_name, stu_u.last_name as student_last_name,
             stu_u.email as student_email,
             d_stu.id as student_department_id, d_stu.code as student_department_code, d_stu.name as student_department_name,
             tp.user_id as teacher_user_id, tp.office_room, tp.designation,
             tch_u.first_name as teacher_first_name, tch_u.last_name as teacher_last_name,
             tch_u.email as teacher_email,
             d_tch.id as teacher_department_id, d_tch.code as teacher_department_code, d_tch.name as teacher_department_name,
             s.slot_date, s.start_time, s.end_time, s.start_timestamp, s.end_timestamp
      FROM appointments a
      JOIN student_profiles sp ON a.student_id = sp.id
      JOIN users stu_u ON sp.user_id = stu_u.id
      JOIN departments d_stu ON sp.department_id = d_stu.id
      JOIN teacher_profiles tp ON a.teacher_id = tp.id
      JOIN users tch_u ON tp.user_id = tch_u.id
      JOIN departments d_tch ON tp.department_id = d_tch.id
      JOIN teacher_availability_slots s ON a.slot_id = s.id
      ${whereClause}
      ORDER BY ${orderColumn} ${normalizedSortOrder}
      LIMIT ? OFFSET ?;
    `;

    const rows = await db.query(dataQuery, [...params, parsedLimit, offset]);

    const appointments = rows.map((r) => ({
      id: r.id,
      title: r.title,
      purpose: r.purpose,
      status: r.status,
      cancellationReason: r.cancellation_reason,
      cancelledBy: r.cancelled_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      student: {
        profileId: r.student_id,
        userId: r.student_user_id,
        studentIdNumber: r.student_id_number,
        firstName: r.student_first_name,
        lastName: r.student_last_name,
        email: r.student_email,
        department: {
          id: r.student_department_id,
          code: r.student_department_code,
          name: r.student_department_name
        }
      },
      teacher: {
        profileId: r.teacher_id,
        userId: r.teacher_user_id,
        firstName: r.teacher_first_name,
        lastName: r.teacher_last_name,
        email: r.teacher_email,
        designation: r.designation,
        officeRoom: r.office_room,
        department: {
          id: r.teacher_department_id,
          code: r.teacher_department_code,
          name: r.teacher_department_name
        }
      },
      slot: {
        id: r.slot_id,
        slotDate: r.slot_date,
        startTime: r.start_time,
        endTime: r.end_time,
        startTimestamp: r.start_timestamp,
        endTimestamp: r.end_timestamp
      }
    }));

    return {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages,
      appointments
    };
  },

  /**
   * PART A: Aggregated metrics & real-time counts derived from real database records.
   *
   * @returns {Promise<Object>}
   */
  async getAppointmentSummary() {
    const summaryRow = await db.queryOne(
      `SELECT
         count(*) as total,
         SUM(CASE WHEN a.status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
         SUM(CASE WHEN a.status = 'APPROVED' THEN 1 ELSE 0 END) as approved_count,
         SUM(CASE WHEN a.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count,
         SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count,
         SUM(CASE WHEN a.status = 'RESCHEDULE_PENDING' THEN 1 ELSE 0 END) as reschedule_pending_count,
         SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_count,
         SUM(CASE WHEN s.start_timestamp > CURRENT_TIMESTAMP AND a.status IN ('PENDING', 'APPROVED', 'RESCHEDULE_PENDING') THEN 1 ELSE 0 END) as upcoming_count,
         SUM(CASE WHEN s.slot_date = date('now') THEN 1 ELSE 0 END) as today_count
       FROM appointments a
       JOIN teacher_availability_slots s ON a.slot_id = s.id;`
    );

    return {
      total: parseInt(summaryRow.total || 0, 10),
      byStatus: {
        [APPOINTMENT_STATUS.PENDING]: parseInt(summaryRow.pending_count || 0, 10),
        [APPOINTMENT_STATUS.APPROVED]: parseInt(summaryRow.approved_count || 0, 10),
        [APPOINTMENT_STATUS.REJECTED]: parseInt(summaryRow.rejected_count || 0, 10),
        [APPOINTMENT_STATUS.CANCELLED]: parseInt(summaryRow.cancelled_count || 0, 10),
        [APPOINTMENT_STATUS.RESCHEDULE_PENDING]: parseInt(summaryRow.reschedule_pending_count || 0, 10),
        [APPOINTMENT_STATUS.COMPLETED]: parseInt(summaryRow.completed_count || 0, 10)
      },
      upcoming: parseInt(summaryRow.upcoming_count || 0, 10),
      today: parseInt(summaryRow.today_count || 0, 10),
      completed: parseInt(summaryRow.completed_count || 0, 10)
    };
  },

  /**
   * PART A: Detailed appointment view with student, teacher, slot, history, reschedules, and feedback.
   *
   * @param {number} appointmentId
   * @returns {Promise<Object>}
   */
  async getAppointmentById(appointmentId) {
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric appointment ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_APPOINTMENT_ID');
    }

    const r = await db.queryOne(
      `SELECT a.id, a.student_id, a.teacher_id, a.slot_id, a.title, a.purpose,
              a.status, a.cancellation_reason, a.cancelled_by, a.created_at, a.updated_at,
              sp.user_id as student_user_id, sp.student_id_number,
              stu_u.first_name as student_first_name, stu_u.last_name as student_last_name,
              stu_u.email as student_email,
              d_stu.id as student_department_id, d_stu.code as student_department_code, d_stu.name as student_department_name,
              tp.user_id as teacher_user_id, tp.office_room, tp.designation,
              tch_u.first_name as teacher_first_name, tch_u.last_name as teacher_last_name,
              tch_u.email as teacher_email,
              d_tch.id as teacher_department_id, d_tch.code as teacher_department_code, d_tch.name as teacher_department_name,
              s.slot_date, s.start_time, s.end_time, s.start_timestamp, s.end_timestamp,
              s.is_booked as slot_is_booked, s.is_active as slot_is_active
       FROM appointments a
       JOIN student_profiles sp ON a.student_id = sp.id
       JOIN users stu_u ON sp.user_id = stu_u.id
       JOIN departments d_stu ON sp.department_id = d_stu.id
       JOIN teacher_profiles tp ON a.teacher_id = tp.id
       JOIN users tch_u ON tp.user_id = tch_u.id
       JOIN departments d_tch ON tp.department_id = d_tch.id
       JOIN teacher_availability_slots s ON a.slot_id = s.id
       WHERE a.id = ?
       LIMIT 1;`,
      [parsedId]
    );

    if (!r) {
      throw new AppError(`Appointment #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'APPOINTMENT_NOT_FOUND');
    }

    // Status transition history
    const historyRows = await db.query(
      `SELECT h.id, h.previous_status, h.new_status, h.notes, h.changed_at, h.changed_by,
              u.first_name, u.last_name, u.email as changed_by_email, r.name as role_name
       FROM appointment_status_history h
       JOIN users u ON h.changed_by = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE h.appointment_id = ?
       ORDER BY h.changed_at ASC, h.id ASC;`,
      [parsedId]
    );

    // Reschedule negotiation history
    const rescheduleRows = await db.query(
      `SELECT ar.id, ar.requested_by, ar.original_slot_id, ar.proposed_slot_id, ar.reason,
              ar.status, ar.created_at, ar.resolved_at,
              u.first_name, u.last_name, u.email as requested_by_email
       FROM appointment_reschedules ar
       JOIN users u ON ar.requested_by = u.id
       WHERE ar.appointment_id = ?
       ORDER BY ar.created_at ASC;`,
      [parsedId]
    );

    // Feedback rating (if submitted)
    const feedback = await db.queryOne(
      `SELECT id, rating, comments, created_at
       FROM feedback_ratings
       WHERE appointment_id = ?
       LIMIT 1;`,
      [parsedId]
    );

    return {
      id: r.id,
      title: r.title,
      purpose: r.purpose,
      status: r.status,
      cancellationReason: r.cancellation_reason,
      cancelledBy: r.cancelled_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      student: {
        profileId: r.student_id,
        userId: r.student_user_id,
        studentIdNumber: r.student_id_number,
        firstName: r.student_first_name,
        lastName: r.student_last_name,
        email: r.student_email,
        department: {
          id: r.student_department_id,
          code: r.student_department_code,
          name: r.student_department_name
        }
      },
      teacher: {
        profileId: r.teacher_id,
        userId: r.teacher_user_id,
        firstName: r.teacher_first_name,
        lastName: r.teacher_last_name,
        email: r.teacher_email,
        designation: r.designation,
        officeRoom: r.office_room,
        department: {
          id: r.teacher_department_id,
          code: r.teacher_department_code,
          name: r.teacher_department_name
        }
      },
      slot: {
        id: r.slot_id,
        slotDate: r.slot_date,
        startTime: r.start_time,
        endTime: r.end_time,
        startTimestamp: r.start_timestamp,
        endTimestamp: r.end_timestamp,
        isBooked: r.slot_is_booked,
        isActive: r.slot_is_active
      },
      history: historyRows.map((h) => ({
        id: h.id,
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        notes: h.notes,
        changedAt: h.changed_at,
        changedBy: {
          userId: h.changed_by,
          email: h.changed_by_email,
          name: `${h.first_name} ${h.last_name}`,
          role: h.role_name
        }
      })),
      reschedules: rescheduleRows.map((res) => ({
        id: res.id,
        originalSlotId: res.original_slot_id,
        proposedSlotId: res.proposed_slot_id,
        reason: res.reason,
        status: res.status,
        createdAt: res.created_at,
        resolvedAt: res.resolved_at,
        requestedBy: {
          userId: res.requested_by,
          email: res.requested_by_email,
          name: `${res.first_name} ${res.last_name}`
        }
      })),
      feedback: feedback ? {
        id: feedback.id,
        rating: feedback.rating,
        comments: feedback.comments,
        createdAt: feedback.created_at
      } : null
    };
  },

  /**
   * PART B: Correct permitted appointment metadata (title, purpose).
   * Strictly prevents modifying participants or slot directly via metadata patch.
   *
   * @param {number} appointmentId
   * @param {Object} updates
   * @param {string} [updates.title]
   * @param {string} [updates.purpose]
   * @param {Object} adminUser
   * @param {string} ipAddress
   * @returns {Promise<Object>}
   */
  async updateAppointmentMetadata(appointmentId, updates, adminUser, ipAddress) {
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric appointment ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_APPOINTMENT_ID');
    }

    const current = await db.queryOne('SELECT id, title, purpose, status FROM appointments WHERE id = ?;', [parsedId]);
    if (!current) {
      throw new AppError(`Appointment #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'APPOINTMENT_NOT_FOUND');
    }

    // Defense-in-depth: disallow altering participants or slot through metadata update
    if (updates.studentId !== undefined || updates.student_id !== undefined ||
        updates.teacherId !== undefined || updates.teacher_id !== undefined) {
      throw new AppError('Participant reassignment is not permitted via appointment metadata update.', HTTP_STATUS.BAD_REQUEST, 'IMMUTABLE_PARTICIPANTS');
    }

    if (updates.slotId !== undefined || updates.slot_id !== undefined) {
      throw new AppError('Consultation slot modification must go through the dedicated reschedule workflow.', HTTP_STATUS.BAD_REQUEST, 'SLOT_UPDATE_NOT_PERMITTED');
    }

    if (updates.status !== undefined) {
      throw new AppError('Status changes must be performed through approved status workflows.', HTTP_STATUS.BAD_REQUEST, 'STATUS_UPDATE_NOT_PERMITTED');
    }

    const { title, purpose } = updates;

    if (title === undefined && purpose === undefined) {
      throw new AppError('At least one permitted field (title or purpose) must be provided.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    }

    let updatedTitle = current.title;
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
        throw new AppError('Title must be between 3 and 200 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }
      updatedTitle = title.trim();
    }

    let updatedPurpose = current.purpose;
    if (purpose !== undefined) {
      if (typeof purpose !== 'string' || purpose.trim().length < 5 || purpose.trim().length > 1000) {
        throw new AppError('Purpose must be between 5 and 1000 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }
      updatedPurpose = purpose.trim();
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE appointments
         SET title = ?, purpose = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [updatedTitle, updatedPurpose, parsedId]
      );

      // Record administrative audit trail
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'UPDATE_APPOINTMENT_METADATA',
        entityId: parsedId,
        details: {
          previous: { title: current.title, purpose: current.purpose },
          updated: { title: updatedTitle, purpose: updatedPurpose }
        },
        ipAddress
      });

      logger.info(`[AdminAppointmentService] Admin #${adminUser.id} updated metadata for Appointment #${parsedId}`);
      return this.getAppointmentById(parsedId);
    });
  },

  /**
   * PART B: Manage appointment status through approved workflows.
   * Strictly enforces lifecycle state machine (ALLOWED_TRANSITIONS).
   * Arbitrary status jumps or terminal overrides are denied.
   *
   * @param {number} appointmentId
   * @param {Object} params
   * @param {string} params.status - target status
   * @param {string} [params.reason]
   * @param {string} [params.notes]
   * @param {Object} adminUser
   * @param {string} ipAddress
   * @returns {Promise<Object>}
   */
  async updateAppointmentStatus(appointmentId, { status, reason, notes }, adminUser, ipAddress) {
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric appointment ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_APPOINTMENT_ID');
    }

    if (!status || typeof status !== 'string' || !Object.values(APPOINTMENT_STATUS).includes(status.trim().toUpperCase())) {
      throw new AppError(
        `Invalid status. Must be one of: ${Object.values(APPOINTMENT_STATUS).join(', ')}`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_STATUS'
      );
    }
    const targetStatus = status.trim().toUpperCase();

    const appointment = await db.queryOne(
      'SELECT id, student_id, teacher_id, slot_id, status FROM appointments WHERE id = ?;',
      [parsedId]
    );
    if (!appointment) {
      throw new AppError(`Appointment #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'APPOINTMENT_NOT_FOUND');
    }

    // Enforce lifecycle state machine: NO arbitrary status transitions
    if (!isValidTransition(appointment.status, targetStatus)) {
      throw new AppError(
        `Cannot transition appointment from status '${appointment.status}' to '${targetStatus}'. Transition is not permitted by lifecycle rules.`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_STATUS_TRANSITION'
      );
    }

    return db.transaction(async (tx) => {
      const auditDetails = {
        previousStatus: appointment.status,
        newStatus: targetStatus,
        reason: reason || null,
        notes: notes || null
      };

      if (targetStatus === APPOINTMENT_STATUS.CANCELLED) {
        const reasonText = reason && reason.trim().length >= 3
          ? reason.trim()
          : (notes && notes.trim().length >= 3 ? notes.trim() : 'Cancelled by administrator');

        // 1. Mark appointment CANCELLED
        await tx.execute(
          `UPDATE appointments
           SET status = 'CANCELLED', cancellation_reason = ?, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?;`,
          [reasonText, adminUser.id, parsedId]
        );

        // 2. Release slot
        await tx.execute(
          'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
          [appointment.slot_id]
        );

        // 3. Record status history
        await tx.execute(
          `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
           VALUES (?, ?, 'CANCELLED', ?, ?);`,
          [parsedId, appointment.status, adminUser.id, reasonText]
        );
      } else if (targetStatus === APPOINTMENT_STATUS.REJECTED) {
        const reasonText = reason && reason.trim().length >= 3
          ? reason.trim()
          : (notes && notes.trim().length >= 3 ? notes.trim() : 'Rejected by administrator');

        // 1. Mark appointment REJECTED
        await tx.execute(
          `UPDATE appointments
           SET status = 'REJECTED', cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?;`,
          [reasonText, parsedId]
        );

        // 2. Release slot
        await tx.execute(
          'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
          [appointment.slot_id]
        );

        // 3. Record status history
        await tx.execute(
          `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
           VALUES (?, ?, 'REJECTED', ?, ?);`,
          [parsedId, appointment.status, adminUser.id, reasonText]
        );
      } else if (targetStatus === APPOINTMENT_STATUS.APPROVED) {
        // Assert no slot conflict
        await conflictService.assertNoConflict({ slotId: appointment.slot_id, excludeAppointmentId: parsedId, tx });

        // Update appointment status to APPROVED
        await tx.execute(
          `UPDATE appointments
           SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?;`,
          [parsedId]
        );

        // Ensure slot is locked as booked
        await tx.execute(
          'UPDATE teacher_availability_slots SET is_booked = 1 WHERE id = ?;',
          [appointment.slot_id]
        );

        // Record status history
        await tx.execute(
          `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
           VALUES (?, ?, 'APPROVED', ?, ?);`,
          [parsedId, appointment.status, adminUser.id, notes || 'Approved by administrator']
        );
      } else if (targetStatus === APPOINTMENT_STATUS.COMPLETED) {
        // Mark COMPLETED
        await tx.execute(
          `UPDATE appointments
           SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?;`,
          [parsedId]
        );

        // Record status history
        await tx.execute(
          `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
           VALUES (?, ?, 'COMPLETED', ?, ?);`,
          [parsedId, appointment.status, adminUser.id, notes || 'Marked completed by administrator']
        );
      }

      // Record administrative audit entry
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'ADMIN_UPDATE_APPOINTMENT_STATUS',
        entityId: parsedId,
        details: auditDetails,
        ipAddress
      });

      logger.info(`[AdminAppointmentService] Admin #${adminUser.id} transitioned Appointment #${parsedId} from ${appointment.status} to ${targetStatus}`);

      return {
        id: parsedId,
        previousStatus: appointment.status,
        status: targetStatus,
        message: `Appointment status updated to ${targetStatus}.`
      };
    });
  },

  /**
   * PART B: Admin reschedule an appointment with conflict detection & atomic slot migration.
   *
   * @param {number} appointmentId
   * @param {Object} params
   * @param {number} params.proposedSlotId
   * @param {string} params.reason
   * @param {Object} adminUser
   * @param {string} ipAddress
   * @returns {Promise<Object>}
   */
  async rescheduleAppointment(appointmentId, { proposedSlotId, reason }, adminUser, ipAddress) {
    const parsedId = parseInt(appointmentId, 10);
    if (!parsedId || isNaN(parsedId)) {
      throw new AppError('Valid numeric appointment ID is required.', HTTP_STATUS.BAD_REQUEST, 'INVALID_APPOINTMENT_ID');
    }

    const parsedSlotId = parseInt(proposedSlotId, 10);
    if (!parsedSlotId || isNaN(parsedSlotId)) {
      throw new AppError('Valid numeric proposedSlotId is required.', HTTP_STATUS.BAD_REQUEST, 'PROPOSED_SLOT_REQUIRED');
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new AppError('A valid reschedule reason (minimum 3 characters) is required.', HTTP_STATUS.BAD_REQUEST, 'RESCHEDULE_REASON_REQUIRED');
    }

    const appointment = await db.queryOne(
      'SELECT id, student_id, teacher_id, slot_id, status FROM appointments WHERE id = ?;',
      [parsedId]
    );
    if (!appointment) {
      throw new AppError(`Appointment #${parsedId} not found.`, HTTP_STATUS.NOT_FOUND, 'APPOINTMENT_NOT_FOUND');
    }

    // Terminal appointments cannot be rescheduled
    if (isTerminalStatus(appointment.status)) {
      throw new AppError(
        `Cannot reschedule an appointment in terminal status '${appointment.status}'.`,
        HTTP_STATUS.BAD_REQUEST,
        'CANNOT_RESCHEDULE_TERMINAL'
      );
    }

    if (appointment.slot_id === parsedSlotId) {
      throw new AppError('Proposed slot is identical to current appointment slot.', HTTP_STATUS.BAD_REQUEST, 'SAME_SLOT_RESCHEDULE');
    }

    return db.transaction(async (tx) => {
      // 1. Validate slot belongs to SAME teacher and is open
      const proposedSlot = await slotService.validateSlotForBooking(parsedSlotId, appointment.teacher_id);

      // 2. Conflict Detection: Assert no overlapping appointments exist for this teacher
      await conflictService.assertNoConflict({ slotId: parsedSlotId, excludeAppointmentId: parsedId, tx });

      // 3. Atomically reserve proposed slot
      const lockProposed = await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 1 WHERE id = ? AND is_booked = 0;',
        [parsedSlotId]
      );
      if (lockProposed.changes === 0) {
        throw new AppError(
          'The proposed reschedule slot has just been reserved by another consultation.',
          HTTP_STATUS.CONFLICT,
          'SLOT_ALREADY_BOOKED'
        );
      }

      // 4. Release original slot
      await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
        [appointment.slot_id]
      );

      // 5. Update appointment record
      await tx.execute(
        `UPDATE appointments
         SET slot_id = ?, status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [parsedSlotId, parsedId]
      );

      // 6. Record reschedule log
      await tx.execute(
        `INSERT INTO appointment_reschedules
         (appointment_id, requested_by, original_slot_id, proposed_slot_id, reason, status, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'ACCEPTED', CURRENT_TIMESTAMP);`,
        [parsedId, adminUser.id, appointment.slot_id, parsedSlotId, reason.trim()]
      );

      // 7. Record status history
      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'APPROVED', ?, ?);`,
        [
          parsedId,
          appointment.status,
          adminUser.id,
          `Admin rescheduled from slot #${appointment.slot_id} to #${parsedSlotId}. Reason: ${reason.trim()}`
        ]
      );

      // 8. Record audit log
      await this.recordAudit(tx, {
        actorId: adminUser.id,
        action: 'ADMIN_RESCHEDULE_APPOINTMENT',
        entityId: parsedId,
        details: {
          previousSlotId: appointment.slot_id,
          newSlotId: parsedSlotId,
          reason: reason.trim()
        },
        ipAddress
      });

      logger.info(`[AdminAppointmentService] Admin #${adminUser.id} rescheduled Appointment #${parsedId} to Slot #${parsedSlotId}`);

      return {
        id: parsedId,
        previousSlotId: appointment.slot_id,
        newSlotId: parsedSlotId,
        status: APPOINTMENT_STATUS.APPROVED,
        slotDetails: {
          slotDate: proposedSlot.slot_date,
          startTime: proposedSlot.start_time,
          endTime: proposedSlot.end_time,
          durationMinutes: proposedSlot.durationMinutes
        },
        message: 'Appointment successfully rescheduled by administrator.'
      };
    });
  },

  /**
   * Status action convenience shortcuts (delegating cleanly with strict lifecycle enforcement):
   */
  async approveAppointment(appointmentId, adminUser, notes = '', ipAddress) {
    return this.updateAppointmentStatus(appointmentId, { status: APPOINTMENT_STATUS.APPROVED, notes }, adminUser, ipAddress);
  },

  async rejectAppointment(appointmentId, adminUser, { reason, notes } = {}, ipAddress) {
    return this.updateAppointmentStatus(appointmentId, { status: APPOINTMENT_STATUS.REJECTED, reason, notes }, adminUser, ipAddress);
  },

  async cancelAppointment(appointmentId, adminUser, { cancellationReason } = {}, ipAddress) {
    return this.updateAppointmentStatus(appointmentId, { status: APPOINTMENT_STATUS.CANCELLED, reason: cancellationReason, notes: cancellationReason }, adminUser, ipAddress);
  },

  async completeAppointment(appointmentId, adminUser, { notes } = {}, ipAddress) {
    return this.updateAppointmentStatus(appointmentId, { status: APPOINTMENT_STATUS.COMPLETED, notes }, adminUser, ipAddress);
  },

  /**
   * View full chronological status transition history for an appointment.
   *
   * @param {number} appointmentId
   * @returns {Promise<Object>}
   */
  async getAppointmentHistory(appointmentId) {
    const details = await this.getAppointmentById(appointmentId);
    return {
      appointmentId: details.id,
      totalEntries: details.history.length,
      history: details.history
    };
  }
};

module.exports = adminAppointmentService;
