/**
 * Appointment Routes (/api/v1/appointments)
 * Mounts endpoints for appointment creation, status lifecycle transitions,
 * cancellations, reschedules, and chronological history tracking.
 */

const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validator');

// Validation Schemas
const createAppointmentSchema = {
  slotId: {
    required: true,
    type: 'number'
  },
  title: {
    required: true,
    type: 'string',
    minLength: 3,
    maxLength: 200
  },
  purpose: {
    required: true,
    type: 'string',
    minLength: 5,
    maxLength: 1000
  }
};

const cancelAppointmentSchema = {
  cancellationReason: {
    required: true,
    type: 'string',
    minLength: 3,
    maxLength: 500
  }
};

const rescheduleAppointmentSchema = {
  proposedSlotId: {
    required: true,
    type: 'number'
  },
  reason: {
    required: true,
    type: 'string',
    minLength: 3,
    maxLength: 500
  }
};

// All appointment operations require authentication
router.use(authenticate);

// Lifecycle & Conflict Operations
router.post('/check-conflict', appointmentController.checkConflict);
router.post('/', validate(createAppointmentSchema), appointmentController.create);
router.get('/', appointmentController.list);
router.get('/:id', appointmentController.get);
router.post('/:id/approve', appointmentController.approve);
router.post('/:id/reject', appointmentController.reject);
router.post('/:id/cancel', validate(cancelAppointmentSchema), appointmentController.cancel);
router.post('/:id/reschedule', validate(rescheduleAppointmentSchema), appointmentController.reschedule);
router.post('/:id/complete', appointmentController.complete);
router.get('/:id/history', appointmentController.history);

module.exports = router;
