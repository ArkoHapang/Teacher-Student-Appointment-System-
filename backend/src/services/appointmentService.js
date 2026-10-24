/**
 * Core Appointment Business Logic Service
 * Enforces:
 * 1. Role-based scoping and strict resource ownership
 * 2. Deterministic lifecycle transitions and terminal state protection
 * 3. Race condition prevention using atomic database transactions and slot locking
 * 4. Automatic status history audit tracking
 * 5. Dynamic slot reservation and release upon cancellation/rejection
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { ROLES, APPOINTMENT_STATUS } = require('../constants/roles');
const { isValidTransition, isTerminalStatus } = require('../constants/appointmentLifecycle');
const slotService = require('./slotService');
const conflictService = require('./conflictService');
const { AppError } = require('../middlewares/errorHandler');
const logger = require('../config/logger');

const appointmentService = {
  /**
   * Helper: Resolve student_profile id for a given user id.
   */
  async getStudentProfileByUserId(userId) {
    const profile = await db.queryOne(
      'SELECT id, user_id, department_id, student_id_number FROM student_profiles WHERE user_id = ?;',
      [userId]
    );
    if (!profile) {
      throw new AppError(
        'A valid student profile is required to perform this appointment operation.',
        HTTP_STATUS.FORBIDDEN,
        'STUDENT_PROFILE_REQUIRED'
      );
    }
    return profile;
  },

  /**
   * Helper: Resolve teacher_profile id for a given user id.
   */
  async getTeacherProfileByUserId(userId) {
    const profile = await db.queryOne(
      'SELECT id, user_id, department_id, designation, is_verified FROM teacher_profiles WHERE user_id = ?;',
      [userId]
    );
    if (!profile) {
      throw new AppError(
        'A valid faculty profile is required to perform this teacher operation.',
        HTTP_STATUS.FORBIDDEN,
        'TEACHER_PROFILE_REQUIRED'
      );
    }
    return profile;
  },

  /**
   * Operation 1: Create an appointment request.
   * Race-condition safe: executes in an atomic transaction with conditional slot update.
   */
  async createAppointment({ user, slotId, title, purpose }) {
    if (user.role !== ROLES.STUDENT && user.role !== ROLES.ADMIN) {
      throw new AppError(
        'Only students can create consultation appointment requests.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    // Resolve student profile
    const studentProfile = await this.getStudentProfileByUserId(user.id);

    return db.transaction(async (tx) => {
      // 1. Validate slot availability, future timestamp, and duration
      const slot = await slotService.validateSlotForBooking(slotId);

      // 2. Conflict Detection: Assert no overlapping appointments exist for this teacher
      await conflictService.assertNoConflict({ slotId, tx });

      // 3. Concurrency Lock: Atomic conditional slot booking
      // If another transaction booked this slot between read and write, changes will be 0
      const lockResult = await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 1 WHERE id = ? AND is_booked = 0;',
        [slotId]
      );

      if (lockResult.changes === 0) {
        throw new AppError(
          'The requested availability slot has already been reserved by another request.',
          HTTP_STATUS.CONFLICT,
          'SLOT_ALREADY_BOOKED'
        );
      }

      // 3. Insert appointment record
      const insertResult = await tx.execute(
        `INSERT INTO appointments (student_id, teacher_id, slot_id, title, purpose, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING');`,
        [studentProfile.id, slot.teacher_id, slotId, title.trim(), purpose.trim()]
      );

      const appointmentId = insertResult.lastInsertRowid;

      // 4. Record chronological status history
      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, NULL, 'PENDING', ?, ?);`,
        [appointmentId, user.id, 'Appointment requested by student']
      );

      logger.info(`[AppointmentService] Appointment #${appointmentId} requested by User #${user.id} for Slot #${slotId}`);

      return {
        id: appointmentId,
        studentId: studentProfile.id,
        teacherId: slot.teacher_id,
        slotId,
        title: title.trim(),
        purpose: purpose.trim(),
        status: APPOINTMENT_STATUS.PENDING,
        slotDetails: {
          slotDate: slot.slot_date,
          startTime: slot.start_time,
          endTime: slot.end_time,
          durationMinutes: slot.durationMinutes,
          teacherName: `${slot.teacher_first_name} ${slot.teacher_last_name}`,
          officeRoom: slot.office_room
        }
      };
    });
  },

  /**
   * Operation 2: View appointments according to authenticated user's permissions.
   * - Students view only their own appointments.
   * - Teachers view only appointments assigned to them.
   * - Admins view all appointments with optional filtering.
   */
  async getAppointments(user, query = {}) {
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (user.role === ROLES.STUDENT) {
      const studentProfile = await this.getStudentProfileByUserId(user.id);
      whereClause += ' AND a.student_id = ?';
      params.push(studentProfile.id);
    } else if (user.role === ROLES.TEACHER) {
      const teacherProfile = await this.getTeacherProfileByUserId(user.id);
      whereClause += ' AND a.teacher_id = ?';
      params.push(teacherProfile.id);
    } else if (user.role === ROLES.ADMIN) {
      // Optional admin filters
      if (query.studentId) {
        whereClause += ' AND a.student_id = ?';
        params.push(parseInt(query.studentId, 10));
      }
      if (query.teacherId) {
        whereClause += ' AND a.teacher_id = ?';
        params.push(parseInt(query.teacherId, 10));
      }
    }

    if (query.status) {
      whereClause += ' AND a.status = ?';
      params.push(query.status.toUpperCase());
    }

    const appointments = await db.query(
      `SELECT a.id, a.student_id, a.teacher_id, a.slot_id, a.title, a.purpose,
              a.status, a.cancellation_reason, a.cancelled_by, a.created_at, a.updated_at,
              stu_u.first_name as student_first_name, stu_u.last_name as student_last_name,
              stu_u.email as student_email, sp.student_id_number,
              tch_u.first_name as teacher_first_name, tch_u.last_name as teacher_last_name,
              tch_u.email as teacher_email, tp.office_room, tp.designation,
              s.slot_date, s.start_time, s.end_time, s.start_timestamp, s.end_timestamp
       FROM appointments a
       JOIN student_profiles sp ON a.student_id = sp.id
       JOIN users stu_u ON sp.user_id = stu_u.id
       JOIN teacher_profiles tp ON a.teacher_id = tp.id
       JOIN users tch_u ON tp.user_id = tch_u.id
       JOIN teacher_availability_slots s ON a.slot_id = s.id
       ${whereClause}
       ORDER BY a.created_at DESC;`,
      params
    );

    return {
      total: appointments.length,
      appointments
    };
  },

  /**
   * Helper: Retrieve appointment by ID with role-based ownership validation.
   */
  async getAppointmentById(appointmentId, user) {
    const appointment = await db.queryOne(
      `SELECT a.id, a.student_id, a.teacher_id, a.slot_id, a.title, a.purpose,
              a.status, a.cancellation_reason, a.cancelled_by, a.created_at, a.updated_at,
              sp.user_id as student_user_id, stu_u.first_name as student_first_name,
              stu_u.last_name as student_last_name, stu_u.email as student_email,
              tp.user_id as teacher_user_id, tch_u.first_name as teacher_first_name,
              tch_u.last_name as teacher_last_name, tch_u.email as teacher_email,
              tp.office_room, tp.designation,
              s.slot_date, s.start_time, s.end_time, s.start_timestamp, s.end_timestamp,
              s.is_booked as slot_is_booked
       FROM appointments a
       JOIN student_profiles sp ON a.student_id = sp.id
       JOIN users stu_u ON sp.user_id = stu_u.id
       JOIN teacher_profiles tp ON a.teacher_id = tp.id
       JOIN users tch_u ON tp.user_id = tch_u.id
       JOIN teacher_availability_slots s ON a.slot_id = s.id
       WHERE a.id = ?
       LIMIT 1;`,
      [appointmentId]
    );

    if (!appointment) {
      throw new AppError('The requested appointment does not exist.', HTTP_STATUS.NOT_FOUND, 'APPOINTMENT_NOT_FOUND');
    }

    // Role-based visibility check
    if (user.role === ROLES.STUDENT && appointment.student_user_id !== user.id) {
      throw new AppError(
        'Access denied: you do not have permission to view another student\'s appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    if (user.role === ROLES.TEACHER && appointment.teacher_user_id !== user.id) {
      throw new AppError(
        'Access denied: you do not have permission to view appointments assigned to other faculty members.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    return appointment;
  },

  /**
   * Operation 3a: Approve an appointment as the assigned teacher.
   */
  async approveAppointment(appointmentId, user, notes = '') {
    const appointment = await this.getAppointmentById(appointmentId, user);

    // Enforce rule: Only the assigned teacher or an Admin can approve
    if (user.role !== ROLES.ADMIN && appointment.teacher_user_id !== user.id) {
      throw new AppError(
        'Only the assigned teacher can approve this appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    return db.transaction(async (tx) => {
      // Lifecycle transition validation: PENDING -> APPROVED
      if (!isValidTransition(appointment.status, APPOINTMENT_STATUS.APPROVED)) {
        throw new AppError(
          `Cannot approve an appointment with status '${appointment.status}'. Only PENDING appointments can be approved.`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION'
        );
      }

      await tx.execute(
        `UPDATE appointments
         SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [appointmentId]
      );

      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'APPROVED', ?, ?);`,
        [appointmentId, appointment.status, user.id, notes || 'Appointment approved by faculty member']
      );

      logger.info(`[AppointmentService] Appointment #${appointmentId} APPROVED by User #${user.id}`);

      return {
        id: appointmentId,
        previousStatus: appointment.status,
        status: APPOINTMENT_STATUS.APPROVED,
        message: 'Appointment successfully approved.'
      };
    });
  },

  /**
   * Operation 3b: Reject an appointment as the assigned teacher.
   * Releases the booked slot so it can be re-used.
   */
  async rejectAppointment(appointmentId, user, { reason, notes } = {}) {
    const appointment = await this.getAppointmentById(appointmentId, user);

    // Enforce rule: Only the assigned teacher or an Admin can reject
    if (user.role !== ROLES.ADMIN && appointment.teacher_user_id !== user.id) {
      throw new AppError(
        'Only the assigned teacher can reject this appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    return db.transaction(async (tx) => {
      // Lifecycle transition validation: PENDING -> REJECTED
      if (!isValidTransition(appointment.status, APPOINTMENT_STATUS.REJECTED)) {
        throw new AppError(
          `Cannot reject an appointment with status '${appointment.status}'.`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION'
        );
      }

      // 1. Mark appointment as REJECTED
      await tx.execute(
        `UPDATE appointments
         SET status = 'REJECTED', cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [reason || 'Rejected by faculty member', appointmentId]
      );

      // 2. Release the availability slot for future booking
      await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
        [appointment.slot_id]
      );

      // 3. Record status history
      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'REJECTED', ?, ?);`,
        [appointmentId, appointment.status, user.id, notes || reason || 'Appointment rejected by faculty member']
      );

      logger.info(`[AppointmentService] Appointment #${appointmentId} REJECTED by User #${user.id}. Slot #${appointment.slot_id} released.`);

      return {
        id: appointmentId,
        previousStatus: appointment.status,
        status: APPOINTMENT_STATUS.REJECTED,
        message: 'Appointment rejected. The consultation slot has been released.'
      };
    });
  },

  /**
   * Operation 4: Cancel an appointment according to project rules.
   * Permitted actors: Student owner, assigned teacher, or Admin.
   * Releases the slot back to unbooked status.
   */
  async cancelAppointment(appointmentId, user, { cancellationReason } = {}) {
    if (!cancellationReason || typeof cancellationReason !== 'string' || cancellationReason.trim().length < 3) {
      throw new AppError(
        'A valid cancellation reason (minimum 3 characters) is required.',
        HTTP_STATUS.BAD_REQUEST,
        'CANCELLATION_REASON_REQUIRED'
      );
    }

    const appointment = await this.getAppointmentById(appointmentId, user);

    // Enforce ownership: student owner, assigned teacher, or Admin
    const isOwnerStudent = appointment.student_user_id === user.id;
    const isAssignedTeacher = appointment.teacher_user_id === user.id;
    const isAdmin = user.role === ROLES.ADMIN;

    if (!isOwnerStudent && !isAssignedTeacher && !isAdmin) {
      throw new AppError(
        'Access denied: you do not have permission to cancel this appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    return db.transaction(async (tx) => {
      // Lifecycle transition validation: PENDING or APPROVED -> CANCELLED
      if (!isValidTransition(appointment.status, APPOINTMENT_STATUS.CANCELLED)) {
        throw new AppError(
          `Cannot cancel an appointment with status '${appointment.status}'. Terminal appointments cannot be cancelled.`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION'
        );
      }

      // 1. Mark appointment as CANCELLED
      await tx.execute(
        `UPDATE appointments
         SET status = 'CANCELLED', cancellation_reason = ?, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [cancellationReason.trim(), user.id, appointmentId]
      );

      // 2. Release the consultation slot
      await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
        [appointment.slot_id]
      );

      // 3. Record status history
      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'CANCELLED', ?, ?);`,
        [appointmentId, appointment.status, user.id, `Cancelled: ${cancellationReason.trim()}`]
      );

      logger.info(`[AppointmentService] Appointment #${appointmentId} CANCELLED by User #${user.id}. Slot #${appointment.slot_id} released.`);

      return {
        id: appointmentId,
        previousStatus: appointment.status,
        status: APPOINTMENT_STATUS.CANCELLED,
        cancellationReason: cancellationReason.trim(),
        cancelledBy: user.id,
        message: 'Appointment successfully cancelled and consultation slot released.'
      };
    });
  },

  /**
   * Operation 5: Reschedule an appointment with atomic validation.
   * - Validates proposed slot is active, unbooked, not in the past, and belongs to the SAME teacher.
   * - Atomically reserves proposed slot and releases original slot.
   * - Records history and reschedule ledger.
   */
  async rescheduleAppointment(appointmentId, proposedSlotId, user, { reason } = {}) {
    if (!proposedSlotId || typeof proposedSlotId !== 'number') {
      throw new AppError(
        'A valid proposedSlotId integer is required for rescheduling.',
        HTTP_STATUS.BAD_REQUEST,
        'PROPOSED_SLOT_REQUIRED'
      );
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new AppError(
        'A valid reason (minimum 3 characters) is required for rescheduling.',
        HTTP_STATUS.BAD_REQUEST,
        'RESCHEDULE_REASON_REQUIRED'
      );
    }

    const appointment = await this.getAppointmentById(appointmentId, user);

    // Permitted actors: student owner, assigned teacher, or Admin
    const isOwnerStudent = appointment.student_user_id === user.id;
    const isAssignedTeacher = appointment.teacher_user_id === user.id;
    const isAdmin = user.role === ROLES.ADMIN;

    if (!isOwnerStudent && !isAssignedTeacher && !isAdmin) {
      throw new AppError(
        'Access denied: you do not have permission to reschedule this appointment.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    // Terminal appointments cannot be rescheduled
    if (isTerminalStatus(appointment.status)) {
      throw new AppError(
        `Cannot reschedule an appointment in terminal status '${appointment.status}'.`,
        HTTP_STATUS.BAD_REQUEST,
        'CANNOT_RESCHEDULE_TERMINAL'
      );
    }

    if (appointment.slot_id === proposedSlotId) {
      throw new AppError(
        'Proposed slot is identical to the current appointment slot.',
        HTTP_STATUS.BAD_REQUEST,
        'SAME_SLOT_RESCHEDULE'
      );
    }

    return db.transaction(async (tx) => {
      // 1. Validate proposed slot belongs to the SAME teacher and is available
      const proposedSlot = await slotService.validateSlotForBooking(proposedSlotId, appointment.teacher_id);

      // 2. Conflict Detection: Assert no overlapping appointments exist for this teacher, ignoring the appointment being rescheduled
      await conflictService.assertNoConflict({ slotId: proposedSlotId, excludeAppointmentId: appointmentId, tx });

      // 3. Concurrency Lock: Atomically reserve the proposed slot
      const lockProposed = await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 1 WHERE id = ? AND is_booked = 0;',
        [proposedSlotId]
      );

      if (lockProposed.changes === 0) {
        throw new AppError(
          'The proposed reschedule slot has just been reserved by another student.',
          HTTP_STATUS.CONFLICT,
          'SLOT_ALREADY_BOOKED'
        );
      }

      // 3. Release the original slot
      await tx.execute(
        'UPDATE teacher_availability_slots SET is_booked = 0 WHERE id = ?;',
        [appointment.slot_id]
      );

      // 4. Update appointment record to new slot and APPROVED status
      await tx.execute(
        `UPDATE appointments
         SET slot_id = ?, status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [proposedSlotId, appointmentId]
      );

      // 5. Insert reschedule audit ledger
      await tx.execute(
        `INSERT INTO appointment_reschedules
         (appointment_id, requested_by, original_slot_id, proposed_slot_id, reason, status, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'ACCEPTED', CURRENT_TIMESTAMP);`,
        [appointmentId, user.id, appointment.slot_id, proposedSlotId, reason.trim()]
      );

      // 6. Record status history
      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'APPROVED', ?, ?);`,
        [
          appointmentId,
          appointment.status,
          user.id,
          `Rescheduled from slot #${appointment.slot_id} to #${proposedSlotId}. Reason: ${reason.trim()}`
        ]
      );

      logger.info(`[AppointmentService] Appointment #${appointmentId} rescheduled to Slot #${proposedSlotId} by User #${user.id}`);

      return {
        id: appointmentId,
        previousSlotId: appointment.slot_id,
        newSlotId: proposedSlotId,
        status: APPOINTMENT_STATUS.APPROVED,
        slotDetails: {
          slotDate: proposedSlot.slot_date,
          startTime: proposedSlot.start_time,
          endTime: proposedSlot.end_time,
          durationMinutes: proposedSlot.durationMinutes
        },
        message: 'Appointment successfully rescheduled.'
      };
    });
  },

  /**
   * Complete an appointment (Consultation held).
   */
  async completeAppointment(appointmentId, user, { notes } = {}) {
    const appointment = await this.getAppointmentById(appointmentId, user);

    if (user.role !== ROLES.ADMIN && appointment.teacher_user_id !== user.id) {
      throw new AppError(
        'Only the assigned faculty member can mark an appointment as completed.',
        HTTP_STATUS.FORBIDDEN,
        'FORBIDDEN'
      );
    }

    return db.transaction(async (tx) => {
      if (!isValidTransition(appointment.status, APPOINTMENT_STATUS.COMPLETED)) {
        throw new AppError(
          `Cannot mark an appointment as COMPLETED from status '${appointment.status}'. Must be in APPROVED status.`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION'
        );
      }

      await tx.execute(
        `UPDATE appointments
         SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [appointmentId]
      );

      await tx.execute(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, changed_by, notes)
         VALUES (?, ?, 'COMPLETED', ?, ?);`,
        [appointmentId, appointment.status, user.id, notes || 'Consultation held and completed.']
      );

      return {
        id: appointmentId,
        status: APPOINTMENT_STATUS.COMPLETED,
        message: 'Appointment marked as completed.'
      };
    });
  },

  /**
   * Operation 6: View chronological status history for an appointment.
   */
  async getAppointmentHistory(appointmentId, user) {
    // Check permission to view this appointment first
    await this.getAppointmentById(appointmentId, user);

    const history = await db.query(
      `SELECT h.id, h.appointment_id, h.previous_status, h.new_status, h.notes,
              h.changed_at, h.changed_by, u.email as changed_by_email,
              u.first_name, u.last_name, r.name as role_name
       FROM appointment_status_history h
       JOIN users u ON h.changed_by = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE h.appointment_id = ?
       ORDER BY h.changed_at ASC, h.id ASC;`,
      [appointmentId]
    );

    return {
      appointmentId,
      totalEntries: history.length,
      history
    };
  }
};

module.exports = appointmentService;
