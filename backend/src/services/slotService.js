/**
 * Teacher Availability Slot Service
 * Validates slot existence, availability, duration bounds, and chronological validity.
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { AppError } = require('../middlewares/errorHandler');

const slotService = {
  /**
   * Retrieve slot by ID with teacher details.
   * @param {number} slotId
   * @returns {Promise<Object|null>}
   */
  async getSlotById(slotId) {
    return db.queryOne(
      `SELECT s.*, tp.user_id as teacher_user_id, tp.designation, tp.office_room, tp.is_verified,
              u.first_name as teacher_first_name, u.last_name as teacher_last_name, u.email as teacher_email,
              u.status as teacher_account_status
       FROM teacher_availability_slots s
       JOIN teacher_profiles tp ON s.teacher_id = tp.id
       JOIN users u ON tp.user_id = u.id
       WHERE s.id = ?
       LIMIT 1;`,
      [slotId]
    );
  },

  /**
   * Validate that a slot is fully eligible for booking.
   * Checks existence, active status, unbooked status, future timestamp, and positive duration.
   * @param {number} slotId
   * @param {number|null} expectedTeacherId - Optional check to ensure slot belongs to specific teacher
   * @returns {Promise<Object>} - Validated slot record
   */
  async validateSlotForBooking(slotId, expectedTeacherId = null) {
    const slot = await this.getSlotById(slotId);

    if (!slot) {
      throw new AppError('The requested availability slot does not exist.', HTTP_STATUS.NOT_FOUND, 'SLOT_NOT_FOUND');
    }

    // Teacher match check if specified
    if (expectedTeacherId && slot.teacher_id !== expectedTeacherId) {
      throw new AppError(
        `Slot ${slotId} belongs to a different teacher. Appointments cannot be scheduled across different teachers.`,
        HTTP_STATUS.BAD_REQUEST,
        'DIFFERENT_TEACHER_SLOT'
      );
    }

    // Teacher account verification
    if (!slot.is_verified || slot.teacher_account_status !== 'ACTIVE') {
      throw new AppError(
        'The assigned faculty member is not currently eligible for consultations.',
        HTTP_STATUS.BAD_REQUEST,
        'TEACHER_NOT_AVAILABLE'
      );
    }

    // Slot active check
    if (!slot.is_active) {
      throw new AppError(
        'This consultation slot has been deactivated by the faculty member.',
        HTTP_STATUS.CONFLICT,
        'SLOT_INACTIVE'
      );
    }

    // Already booked check
    if (slot.is_booked) {
      throw new AppError(
        'The requested availability slot is already reserved by another consultation.',
        HTTP_STATUS.CONFLICT,
        'SLOT_UNAVAILABLE'
      );
    }

    // Duration bounds check
    const startMs = new Date(slot.start_timestamp).getTime();
    const endMs = new Date(slot.end_timestamp).getTime();
    const durationMinutes = Math.round((endMs - startMs) / (1000 * 60));

    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      throw new AppError(
        'Slot contains invalid start or end timestamps.',
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        'INVALID_SLOT_TIMESTAMPS'
      );
    }

    if (durationMinutes < 10 || durationMinutes > 180) {
      throw new AppError(
        `Consultation slot duration must be between 10 and 180 minutes. Current: ${durationMinutes} minutes.`,
        HTTP_STATUS.BAD_REQUEST,
        'INVALID_SLOT_DURATION'
      );
    }

    // Past timestamp check
    if (startMs <= Date.now()) {
      throw new AppError(
        'Cannot reserve an availability slot in the past.',
        HTTP_STATUS.BAD_REQUEST,
        'SLOT_IN_PAST'
      );
    }

    return {
      ...slot,
      durationMinutes
    };
  },

  /**
   * List available (unbooked, active, future) slots for a specific teacher.
   * @param {number} teacherId
   * @returns {Promise<Array>}
   */
  async getTeacherAvailableSlots(teacherId) {
    const nowIso = new Date().toISOString();
    return db.query(
      `SELECT s.*, tp.designation, tp.office_room
       FROM teacher_availability_slots s
       JOIN teacher_profiles tp ON s.teacher_id = tp.id
       WHERE s.teacher_id = ?
         AND s.is_booked = 0
         AND s.is_active = 1
         AND s.start_timestamp > ?
       ORDER BY s.start_timestamp ASC;`,
      [teacherId, nowIso]
    );
  },

  /**
   * Create an availability slot (used for testing or faculty slot configuration).
   */
  async createSlot({ teacherId, slotDate, startTime, endTime, startTimestamp, endTimestamp }) {
    const result = await db.execute(
      `INSERT INTO teacher_availability_slots
       (teacher_id, slot_date, start_time, end_time, start_timestamp, end_timestamp, is_booked, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1);`,
      [teacherId, slotDate, startTime, endTime, startTimestamp, endTimestamp]
    );

    return {
      id: result.lastInsertRowid,
      teacherId,
      slotDate,
      startTime,
      endTime,
      startTimestamp,
      endTimestamp,
      isBooked: 0,
      isActive: 1
    };
  }
};

module.exports = slotService;
