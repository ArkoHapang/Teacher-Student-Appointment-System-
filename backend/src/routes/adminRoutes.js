/**
 * Administrative Routes (/api/v1/admin)
 * Server-side RBAC: Exclusively accessible by users with role 'ADMIN'.
 * Students and Teachers attempting to access these routes are rejected with 403 Forbidden.
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate } = require('../middlewares/authMiddleware');
const { authorizeRoles } = require('../middlewares/rbacMiddleware');
const { ROLES } = require('../constants/roles');

// Enforce authentication & ADMIN role server-side for all admin sub-routes
router.use(authenticate);
router.use(authorizeRoles(ROLES.ADMIN));

router.get('/users', adminController.listUsers);
router.patch('/users/:id/status', adminController.updateUserStatus);

// Teacher management (Issue #37)
router.get('/teachers', adminController.listTeachers);
router.post('/teachers', adminController.createTeacher);
router.get('/teachers/:id', adminController.getTeacher);
router.patch('/teachers/:id/status', adminController.updateTeacherStatus);
router.patch('/teachers/:id/verify', adminController.verifyTeacher);
router.patch('/teachers/:id', adminController.updateTeacher);

router.get('/audit-logs', adminController.getAuditLogs);

// Appointment monitoring & management (Issues #38 & #39)
router.get('/appointments/summary', adminController.getAppointmentSummary);
router.get('/appointments', adminController.listAppointments);
router.get('/appointments/:id/history', adminController.getAppointmentHistory);
router.get('/appointments/:id', adminController.getAppointment);
router.patch('/appointments/:id/status', adminController.updateAppointmentStatus);
router.post('/appointments/:id/reschedule', adminController.rescheduleAppointment);
router.post('/appointments/:id/approve', adminController.approveAppointment);
router.post('/appointments/:id/reject', adminController.rejectAppointment);
router.post('/appointments/:id/cancel', adminController.cancelAppointment);
router.post('/appointments/:id/complete', adminController.completeAppointment);
router.patch('/appointments/:id', adminController.updateAppointmentMetadata);

module.exports = router;
