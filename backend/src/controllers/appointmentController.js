/**
 * Appointment Controller
 * Handles HTTP requests for the core appointment lifecycle:
 * Booking, Viewing, Approval, Rejection, Cancellation, Rescheduling, Completion, and History Audit.
 */

const appointmentService = require('../services/appointmentService');
const conflictService = require('../services/conflictService');
const HTTP_STATUS = require('../constants/httpStatusCodes');

const appointmentController = {
  /**
   * POST /api/v1/appointments
   * Create an appointment request
   */
  async create(req, res, next) {
    try {
      const { slotId, title, purpose } = req.body;
      const result = await appointmentService.createAppointment({
        user: req.user,
        slotId: parseInt(slotId, 10),
        title,
        purpose
      });

      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: 'Appointment request submitted successfully.',
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/appointments
   * List appointments accessible by the authenticated user
   */
  async list(req, res, next) {
    try {
      const result = await appointmentService.getAppointments(req.user, req.query);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/appointments/:id
   * Get appointment details by ID
   */
  async get(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const appointment = await appointmentService.getAppointmentById(appointmentId, req.user);
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: appointment
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/appointments/:id/approve
   * Approve an appointment (Faculty / Admin only)
   */
  async approve(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const { notes } = req.body;
      const result = await appointmentService.approveAppointment(appointmentId, req.user, notes);

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
   * POST /api/v1/appointments/:id/reject
   * Reject an appointment request (Faculty / Admin only)
   */
  async reject(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const { reason, notes } = req.body;
      const result = await appointmentService.rejectAppointment(appointmentId, req.user, { reason, notes });

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
   * POST /api/v1/appointments/:id/cancel
   * Cancel an appointment (Student owner, Faculty, or Admin)
   */
  async cancel(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const { cancellationReason } = req.body;
      const result = await appointmentService.cancelAppointment(appointmentId, req.user, { cancellationReason });

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
   * POST /api/v1/appointments/:id/reschedule
   * Reschedule an appointment to a new slot
   */
  async reschedule(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const proposedSlotId = req.body.proposedSlotId || req.body.slotId || req.body.newSlotId;
      const { reason } = req.body;
      const result = await appointmentService.rescheduleAppointment(
        appointmentId,
        parseInt(proposedSlotId, 10),
        req.user,
        { reason }
      );

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
   * POST /api/v1/appointments/:id/complete
   * Mark appointment completed (Faculty / Admin only)
   */
  async complete(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const { notes } = req.body;
      const result = await appointmentService.completeAppointment(appointmentId, req.user, { notes });

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
   * GET /api/v1/appointments/:id/history
   * Retrieve chronological status transition audit log
   */
  async history(req, res, next) {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const result = await appointmentService.getAppointmentHistory(appointmentId, req.user);

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/appointments/check-conflict
   * Standalone conflict detection API (GitHub Issue #40)
   * Evaluates slotId or { teacherId, startTimestamp, endTimestamp } for scheduling collisions
   */
  async checkConflict(req, res, next) {
    try {
      const { teacherId, slotId, startTimestamp, endTimestamp, excludeAppointmentId } = req.body;
      const result = await conflictService.detectConflicts({
        teacherId: teacherId ? parseInt(teacherId, 10) : undefined,
        slotId: slotId ? parseInt(slotId, 10) : undefined,
        startTimestamp,
        endTimestamp,
        excludeAppointmentId: excludeAppointmentId ? parseInt(excludeAppointmentId, 10) : undefined
      });

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = appointmentController;
