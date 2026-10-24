/**
 * Conflict Detection Service (GitHub Issue #40)
 * Detects scheduling conflicts in the Teacher-Student Appointment System.
 *
 * Enforces:
 * 1. Two appointments assigned to the same teacher that overlap using the interval-overlap rule:
 *    existing_start < requested_end AND requested_start < existing_end
 *    with half-open intervals [start, end), so adjacent slots (10:00-10:30 and 10:30-11:00) do NOT overlap.
 * 2. Teacher being booked outside their available hours.
 * 3. Invalid start and end times (chronology, duration 10-180m, in the past).
 * 4. Overlapping time slots caused by concurrent booking requests.
 * 5. Conflicts introduced by rescheduling (ignoring the appointment being edited).
 * 6. Status-aware blocking: PENDING, APPROVED, and RESCHEDULE_PENDING block availability;
 *    CANCELLED and REJECTED do NOT block availability.
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { APPOINTMENT_STATUS } = require('../constants/roles');
const { AppError } = require('../middlewares/errorHandler');

// Appointment statuses that actively occupy/block faculty consultation time
const BLOCKING_STATUSES = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.APPROVED,
  APPOINTMENT_STATUS.RESCHEDULE_PENDING
];

// Appointment statuses that explicitly release faculty time
const NON_BLOCKING_STATUSES = [
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.REJECTED
];

const conflictService = {
  BLOCKING_STATUSES,
  NON_BLOCKING_STATUSES,

  /**
   * Check if an appointment status blocks availability.
   * @param {string} status
   * @returns {boolean}
   */
  isBlockingStatus(status) {
    return BLOCKING_STATUSES.includes(status);
  },

  /**
   * Pure interval-overlap mathematical evaluation for half-open intervals [start, end).
   * Two intervals [startA, endA) and [startB, endB) overlap if and only if:
   * startA < endB AND startB < endA
   *
   * Example:
   * [10:00, 10:30) and [10:30, 11:00)
   * 10:00 < 11:00 (true) BUT 10:30 < 10:30 (false) -> returns false (Adjacent: NO conflict)
   *
   * @param {string|Date|number} startA
   * @param {string|Date|number} endA
   * @param {string|Date|number} startB
   * @param {string|Date|number} endB
   * @returns {boolean}
   */
  hasIntervalOverlap(startA, endA, startB, endB) {
    const aStartMs = new Date(startA).getTime();
    const aEndMs = new Date(endA).getTime();
    const bStartMs = new Date(startB).getTime();
    const bEndMs = new Date(endB).getTime();

    if (isNaN(aStartMs) || isNaN(aEndMs) || isNaN(bStartMs) || isNaN(bEndMs)) {
      return false;
    }

    return aStartMs < bEndMs && bStartMs < aEndMs;
  },

  /**
   * Validate that start and end timestamps form a valid, permissible consultation window.
   * @param {Object} params
   * @param {string} params.startTimestamp
   * @param {string} params.endTimestamp
   * @param {boolean} [params.allowPast=false]
   * @param {number} [params.minMinutes=10]
   * @param {number} [params.maxMinutes=180]
   * @returns {{ startMs: number, endMs: number, durationMinutes: number }}
   */
  validateTimeRange({ startTimestamp, endTimestamp, allowPast = false, minMinutes = 10, maxMinutes = 180 }) {
    if (!startTimestamp || !endTimestamp) {
      throw new AppError(
        'Both startTimestamp and endTimestamp are required to evaluate consultation intervals.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_TIME_RANGE'
      );
    }

    const startMs = new Date(startTimestamp).getTime();
    const endMs = new Date(endTimestamp).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      throw new AppError(
        'Invalid timestamp format. Timestamps must be valid ISO or YYYY-MM-DD HH:MM:SS strings.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_TIME_RANGE'
      );
    }

    if (startMs >= endMs) {
      throw new AppError(
        'Start time must be strictly earlier than end time.',
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_TIME_RANGE'
      );
    }

    const durationMinutes = Math.round((endMs - startMs) / (1000 * 60));

    if (durationMinutes < minMinutes || durationMinutes > maxMinutes) {
      throw new AppError(
        `Consultation duration must be between ${minMinutes} and ${maxMinutes} minutes. Requested: ${durationMinutes} minutes.`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_SLOT_DURATION'
      );
    }

    if (!allowPast && startMs <= Date.now()) {
      throw new AppError(
        'Cannot schedule appointments in the past.',
        HTTP_STATUS.BAD_REQUEST,
        'SLOT_IN_PAST'
      );
    }

    return { startMs, endMs, durationMinutes };
  },

  /**
   * Query database for any existing appointments of a teacher that overlap with [startTimestamp, endTimestamp).
   * Reusable within an existing transaction or with the default database handle.
   *
   * Ignores non-blocking statuses ('CANCELLED', 'REJECTED').
   * If excludeAppointmentId is provided (e.g. during reschedule), that appointment is ignored.
   *
   * @param {Object} executor - db or tx
   * @param {Object} params
   * @param {number} params.teacherId
   * @param {string} params.startTimestamp
   * @param {string} params.endTimestamp
   * @param {number|null} [params.excludeAppointmentId=null]
   * @returns {Promise<Array>}
   */
  async findOverlappingAppointments(executor, { teacherId, startTimestamp, endTimestamp, excludeAppointmentId = null }) {
    const client = executor || db;
    const placeholders = BLOCKING_STATUSES.map(() => '?').join(', ');
    const params = [teacherId, ...BLOCKING_STATUSES];

    let sql = `
      SELECT a.id as appointment_id,
             a.student_id,
             a.teacher_id,
             a.slot_id,
             a.title,
             a.purpose,
             a.status,
             s.slot_date,
             s.start_time,
             s.end_time,
             s.start_timestamp,
             s.end_timestamp,
             u.first_name as student_first_name,
             u.last_name as student_last_name,
             u.email as student_email
      FROM appointments a
      JOIN teacher_availability_slots s ON a.slot_id = s.id
      JOIN student_profiles sp ON a.student_id = sp.id
      JOIN users u ON sp.user_id = u.id
      WHERE a.teacher_id = ?
        AND a.status IN (${placeholders})
    `;

    if (excludeAppointmentId) {
      sql += ' AND a.id != ?';
      params.push(excludeAppointmentId);
    }

    // Interval overlap condition in SQL:
    // existing_start < requested_end AND requested_start < existing_end
    sql += `
        AND s.start_timestamp < ?
        AND ? < s.end_timestamp
      ORDER BY s.start_timestamp ASC;
    `;
    params.push(endTimestamp, startTimestamp);

    const rows = await client.query(sql, params);

    // Double-verify in memory with pure timestamp arithmetic to ensure absolute precision
    return rows.filter((row) =>
      this.hasIntervalOverlap(row.start_timestamp, row.end_timestamp, startTimestamp, endTimestamp)
    );
  },

  /**
   * Verify whether a requested time interval is contained within any active availability slot of a teacher.
   * @param {Object} executor - db or tx
   * @param {Object} params
   * @param {number} params.teacherId
   * @param {string} params.startTimestamp
   * @param {string} params.endTimestamp
   * @returns {Promise<Object|null>} - Returns the covering slot or null if outside available hours
   */
  async checkTeacherAvailableHours(executor, { teacherId, startTimestamp, endTimestamp }) {
    const client = executor || db;
    return client.queryOne(
      `SELECT s.*
       FROM teacher_availability_slots s
       WHERE s.teacher_id = ?
         AND s.is_active = 1
         AND s.start_timestamp <= ?
         AND ? <= s.end_timestamp
       ORDER BY s.start_timestamp ASC
       LIMIT 1;`,
      [teacherId, startTimestamp, endTimestamp]
    );
  },

  /**
   * Comprehensive conflict detection engine.
   * Evaluates:
   * - Slot existence & active state (if slotId is provided)
   * - Timestamp format and duration boundaries
   * - Teacher availability hours containment
   * - Overlapping appointments for the same teacher
   * - Exclusion of the appointment being edited during reschedule
   *
   * @param {Object} params
   * @param {number} [params.teacherId]
   * @param {number} [params.slotId]
   * @param {string} [params.startTimestamp]
   * @param {string} [params.endTimestamp]
   * @param {number|null} [params.excludeAppointmentId=null]
   * @param {Object|null} [params.tx=null]
   * @returns {Promise<Object>} Detection outcome { hasConflict, conflictType, code, message, details? }
   */
  async detectConflicts({
    teacherId,
    slotId,
    startTimestamp,
    endTimestamp,
    excludeAppointmentId = null,
    tx = null
  }) {
    const client = tx || db;
    let resolvedTeacherId = teacherId;
    let resolvedStart = startTimestamp;
    let resolvedEnd = endTimestamp;
    let resolvedSlot = null;

    // 1. If slotId provided, resolve and validate slot
    if (slotId) {
      resolvedSlot = await client.queryOne(
        `SELECT s.*, tp.user_id as teacher_user_id, u.first_name, u.last_name
         FROM teacher_availability_slots s
         JOIN teacher_profiles tp ON s.teacher_id = tp.id
         JOIN users u ON tp.user_id = u.id
         WHERE s.id = ?
         LIMIT 1;`,
        [slotId]
      );

      if (!resolvedSlot) {
        throw new AppError(
          `The requested availability slot #${slotId} does not exist.`,
          HTTP_STATUS.NOT_FOUND,
          'SLOT_NOT_FOUND'
        );
      }

      resolvedTeacherId = resolvedSlot.teacher_id;
      resolvedStart = resolvedSlot.start_timestamp;
      resolvedEnd = resolvedSlot.end_timestamp;

      if (!resolvedSlot.is_active) {
        return {
          hasConflict: true,
          conflictType: 'OUTSIDE_AVAILABLE_HOURS',
          code: 'TEACHER_OUTSIDE_HOURS',
          message: 'The requested slot has been deactivated and is outside faculty available hours.',
          slotId
        };
      }
    }

    // 2. Validate time range format and boundaries
    try {
      this.validateTimeRange({
        startTimestamp: resolvedStart,
        endTimestamp: resolvedEnd
      });
    } catch (err) {
      return {
        hasConflict: true,
        conflictType: 'INVALID_TIME_RANGE',
        code: err.code || 'INVALID_TIME_RANGE',
        message: err.message
      };
    }

    // 3. Verify teacher availability window if not looking up an existing slot
    if (!slotId && resolvedTeacherId) {
      const coveringSlot = await this.checkTeacherAvailableHours(client, {
        teacherId: resolvedTeacherId,
        startTimestamp: resolvedStart,
        endTimestamp: resolvedEnd
      });

      if (!coveringSlot) {
        return {
          hasConflict: true,
          conflictType: 'OUTSIDE_AVAILABLE_HOURS',
          code: 'TEACHER_OUTSIDE_HOURS',
          message: 'The requested consultation time falls outside the faculty member\'s configured available hours.',
          teacherId: resolvedTeacherId,
          requestedInterval: {
            start: resolvedStart,
            end: resolvedEnd
          }
        };
      }
    }

    // 4. Overlap Check: Look for active/blocking appointments for this teacher in [start, end)
    const overlapping = await this.findOverlappingAppointments(client, {
      teacherId: resolvedTeacherId,
      startTimestamp: resolvedStart,
      endTimestamp: resolvedEnd,
      excludeAppointmentId
    });

    if (overlapping.length > 0) {
      const first = overlapping[0];
      return {
        hasConflict: true,
        conflictType: 'OVERLAPPING_APPOINTMENT',
        code: 'APPOINTMENT_CONFLICT',
        message: `The requested consultation interval (${resolvedStart} to ${resolvedEnd}) conflicts with an existing appointment for this faculty member (Appointment #${first.appointment_id}, status: ${first.status}).`,
        conflictingAppointments: overlapping.map((a) => ({
          appointmentId: a.appointment_id,
          title: a.title,
          status: a.status,
          slotId: a.slot_id,
          start: a.start_timestamp,
          end: a.end_timestamp,
          studentName: `${a.student_first_name} ${a.student_last_name}`,
          studentEmail: a.student_email
        }))
      };
    }

    // 5. If slot is already marked booked, and not owned by the excluded appointment
    if (resolvedSlot && resolvedSlot.is_booked) {
      // Check if this slot is currently assigned to excludeAppointmentId
      let isOwnedByExcluded = false;
      if (excludeAppointmentId) {
        const currentAppt = await client.queryOne(
          'SELECT slot_id FROM appointments WHERE id = ?;',
          [excludeAppointmentId]
        );
        if (currentAppt && currentAppt.slot_id === slotId) {
          isOwnedByExcluded = true;
        }
      }

      if (!isOwnedByExcluded) {
        return {
          hasConflict: true,
          conflictType: 'SLOT_ALREADY_BOOKED',
          code: 'SLOT_ALREADY_BOOKED',
          message: 'The requested availability slot has already been reserved by another consultation.',
          slotId
        };
      }
    }

    return {
      hasConflict: false,
      message: 'No conflicts detected. The consultation window is available.',
      interval: {
        teacherId: resolvedTeacherId,
        startTimestamp: resolvedStart,
        endTimestamp: resolvedEnd
      }
    };
  },

  /**
   * Assertion helper used inside transaction workflows (create / reschedule).
   * Throws an AppError with HTTP 409 Conflict if any conflict is detected.
   *
   * @param {Object} params
   * @throws {AppError}
   */
  async assertNoConflict(params) {
    const result = await this.detectConflicts(params);
    if (result.hasConflict) {
      throw new AppError(
        result.message,
        HTTP_STATUS.CONFLICT,
        result.code || 'APPOINTMENT_CONFLICT',
        {
          conflictType: result.conflictType,
          conflictingAppointments: result.conflictingAppointments || []
        }
      );
    }
    return result;
  }
};

module.exports = conflictService;
