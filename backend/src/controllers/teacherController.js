/**
 * Teacher Profile & Faculty Management Controller
 * Enforces boundary: Teachers must not manage other teachers unless explicitly authorized.
 */

const db = require('../config/database');
const HTTP_STATUS = require('../constants/httpStatusCodes');
const { AppError } = require('../middlewares/errorHandler');
const slotService = require('../services/slotService');

const teacherController = {
  /**
   * GET /api/v1/teachers
   * List directory of teachers
   */
  async listTeachers(req, res, next) {
    try {
      const teachers = await db.query(
        `SELECT tp.id as teacher_profile_id, tp.user_id, tp.designation, tp.office_room,
                tp.bio, tp.is_verified, d.code as department_code, d.name as department_name,
                u.first_name, u.last_name, u.email
         FROM teacher_profiles tp
         JOIN users u ON tp.user_id = u.id
         JOIN departments d ON tp.department_id = d.id
         WHERE u.status = 'ACTIVE'
         ORDER BY tp.id ASC;`
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          total: teachers.length,
          teachers
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/teachers/:id
   * Get specific teacher details
   */
  async getTeacher(req, res, next) {
    try {
      const teacherId = parseInt(req.params.id, 10);
      const teacher = await db.queryOne(
        `SELECT tp.id as teacher_profile_id, tp.user_id, tp.designation, tp.office_room,
                tp.bio, tp.is_verified, d.code as department_code, d.name as department_name,
                u.first_name, u.last_name, u.email
         FROM teacher_profiles tp
         JOIN users u ON tp.user_id = u.id
         JOIN departments d ON tp.department_id = d.id
         WHERE tp.id = ? OR tp.user_id = ?
         LIMIT 1;`,
        [teacherId, teacherId]
      );

      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: teacher
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/teachers/:id/slots
   * Retrieve available consultation slots for a faculty member
   */
  async getTeacherSlots(req, res, next) {
    try {
      const teacherParam = parseInt(req.params.id, 10);
      const teacher = await db.queryOne(
        'SELECT id, user_id FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [teacherParam, teacherParam]
      );
      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      const showAll = req.query.all === 'true';
      let slots;
      if (showAll) {
        slots = await db.query(
          `SELECT s.*, tp.designation, tp.office_room
           FROM teacher_availability_slots s
           JOIN teacher_profiles tp ON s.teacher_id = tp.id
           WHERE s.teacher_id = ?
           ORDER BY s.start_timestamp ASC;`,
          [teacher.id]
        );
      } else {
        slots = await slotService.getTeacherAvailableSlots(teacher.id);
      }

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          total: slots.length,
          slots
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/teachers/:id/slots
   * Configure/Add teacher availability slot
   */
  async createSlot(req, res, next) {
    try {
      const teacherParam = parseInt(req.params.id, 10);
      const teacher = await db.queryOne(
        'SELECT id FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [teacherParam, teacherParam]
      );
      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      const { slotDate, startTime, endTime } = req.body;
      if (!slotDate || !startTime || !endTime) {
        throw new AppError('Slot date, start time, and end time are required.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(slotDate)) {
        throw new AppError('Slot date must be in YYYY-MM-DD format.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime;
      const normalizedEnd = endTime.length === 5 ? `${endTime}:00` : endTime;

      const startTimestamp = `${slotDate} ${normalizedStart}`;
      const endTimestamp = `${slotDate} ${normalizedEnd}`;

      const startMs = new Date(startTimestamp).getTime();
      const endMs = new Date(endTimestamp).getTime();

      if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
        throw new AppError('Start time must precede end time.', HTTP_STATUS.BAD_REQUEST, 'INVALID_SLOT_TIMESTAMPS');
      }

      const durationMinutes = Math.round((endMs - startMs) / (1000 * 60));
      if (durationMinutes < 10 || durationMinutes > 180) {
        throw new AppError(
          `Consultation slot duration must be between 10 and 180 minutes. Current: ${durationMinutes} minutes.`,
          HTTP_STATUS.BAD_REQUEST,
          'INVALID_SLOT_DURATION'
        );
      }

      if (startMs <= Date.now()) {
        throw new AppError('Cannot create availability slots in the past.', HTTP_STATUS.BAD_REQUEST, 'SLOT_IN_PAST');
      }

      // Conflict overlap check: existing_start < requested_end AND requested_start < existing_end
      const conflict = await db.queryOne(
        `SELECT id, slot_date, start_time, end_time
         FROM teacher_availability_slots
         WHERE teacher_id = ?
           AND start_timestamp < ?
           AND ? < end_timestamp
         LIMIT 1;`,
        [teacher.id, endTimestamp, startTimestamp]
      );

      if (conflict) {
        throw new AppError(
          `The proposed time slot overlaps with an existing slot on ${conflict.slot_date} (${conflict.start_time.slice(0, 5)} - ${conflict.end_time.slice(0, 5)}).`,
          HTTP_STATUS.CONFLICT,
          'SLOT_OVERLAP'
        );
      }

      const newSlot = await slotService.createSlot({
        teacherId: teacher.id,
        slotDate,
        startTime: normalizedStart,
        endTime: normalizedEnd,
        startTimestamp,
        endTimestamp
      });

      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: 'Availability slot created successfully.',
        data: newSlot
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/teachers/:id/slots/:slotId
   * Toggle slot active/inactive status
   */
  async updateSlot(req, res, next) {
    try {
      const teacherParam = parseInt(req.params.id, 10);
      const slotId = parseInt(req.params.slotId, 10);
      const teacher = await db.queryOne(
        'SELECT id FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [teacherParam, teacherParam]
      );
      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      const slot = await db.queryOne(
        'SELECT id, is_booked, is_active FROM teacher_availability_slots WHERE id = ? AND teacher_id = ? LIMIT 1;',
        [slotId, teacher.id]
      );
      if (!slot) {
        throw new AppError('Availability slot not found.', HTTP_STATUS.NOT_FOUND, 'SLOT_NOT_FOUND');
      }

      const { isActive } = req.body;
      const newActive = isActive !== undefined ? (isActive ? 1 : 0) : (slot.is_active ? 0 : 1);

      await db.execute(
        'UPDATE teacher_availability_slots SET is_active = ? WHERE id = ?;',
        [newActive, slot.id]
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: `Slot is now ${newActive ? 'active' : 'inactive'}.`,
        data: {
          id: slot.id,
          isActive: newActive
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/v1/teachers/:id/slots/:slotId
   * Delete an unbooked availability slot
   */
  async deleteSlot(req, res, next) {
    try {
      const teacherParam = parseInt(req.params.id, 10);
      const slotId = parseInt(req.params.slotId, 10);
      const teacher = await db.queryOne(
        'SELECT id FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [teacherParam, teacherParam]
      );
      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      const slot = await db.queryOne(
        'SELECT id, is_booked FROM teacher_availability_slots WHERE id = ? AND teacher_id = ? LIMIT 1;',
        [slotId, teacher.id]
      );
      if (!slot) {
        throw new AppError('Availability slot not found.', HTTP_STATUS.NOT_FOUND, 'SLOT_NOT_FOUND');
      }

      if (slot.is_booked) {
        throw new AppError(
          'Cannot delete a consultation slot that has an active booking. Please cancel or complete the appointment first.',
          HTTP_STATUS.CONFLICT,
          'SLOT_BOOKED'
        );
      }

      await db.execute(
        'DELETE FROM teacher_availability_slots WHERE id = ?;',
        [slot.id]
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Availability slot deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/teachers/:id
   * Update teacher profile (office_room, bio, designation)
   * Rule: Teachers must not manage other teachers unless explicitly authorized.
   * Admin can update any teacher.
   */
  async updateTeacher(req, res, next) {
    try {
      const teacherParam = parseInt(req.params.id, 10);
      const { designation, officeRoom, bio } = req.body || {};

      if (designation !== undefined && (typeof designation !== 'string' || designation.trim().length === 0 || designation.trim().length > 100)) {
        throw new AppError('Designation must be a non-empty string under 100 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      if (officeRoom !== undefined && (typeof officeRoom !== 'string' || officeRoom.trim().length === 0 || officeRoom.trim().length > 50)) {
        throw new AppError('Office room must be a non-empty string under 50 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      if (bio !== undefined && (typeof bio !== 'string' || bio.length > 2000)) {
        throw new AppError('Bio must be a string under 2000 characters.', HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
      }

      const teacher = await db.queryOne(
        'SELECT id, designation, office_room, bio FROM teacher_profiles WHERE id = ? OR user_id = ? LIMIT 1;',
        [teacherParam, teacherParam]
      );

      if (!teacher) {
        throw new AppError('Teacher profile not found.', HTTP_STATUS.NOT_FOUND, 'TEACHER_NOT_FOUND');
      }

      const updatedDesignation = designation !== undefined ? designation.trim() : teacher.designation;
      const updatedOfficeRoom = officeRoom !== undefined ? officeRoom.trim() : teacher.office_room;
      const updatedBio = bio !== undefined ? bio.trim() : teacher.bio;

      await db.execute(
        `UPDATE teacher_profiles
         SET designation = ?, office_room = ?, bio = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?;`,
        [updatedDesignation, updatedOfficeRoom, updatedBio, teacher.id]
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Teacher profile successfully updated.',
        data: {
          id: teacher.id,
          designation: updatedDesignation,
          officeRoom: updatedOfficeRoom,
          bio: updatedBio
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = teacherController;
