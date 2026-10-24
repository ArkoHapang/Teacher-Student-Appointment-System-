/**
 * Root Versioned API Router (/api/v1)
 * Mounts all sub-routers under a unified versioned namespace.
 */

const express = require('express');
const router = express.Router();
const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');
const userRoutes = require('./userRoutes');
const teacherRoutes = require('./teacherRoutes');
const appointmentRoutes = require('./appointmentRoutes');

// Mount diagnostics & health check endpoints
router.use('/', healthRoutes);

// Mount feature routers
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/users', userRoutes);
router.use('/teachers', teacherRoutes);
router.use('/appointments', appointmentRoutes);

// Meta endpoint describing API catalog
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Teacher-Student Appointment System API',
      version: 'v1',
      documentation: '/docs',
      status: 'operational',
      endpoints: {
        health: '/api/v1/health',
        ready: '/api/v1/ready',
        auth: {
          login: 'POST /api/v1/auth/login',
          logout: 'POST /api/v1/auth/logout',
          me: 'GET /api/v1/auth/me',
          verify: 'GET /api/v1/auth/verify'
        },
        admin: {
          users: 'GET /api/v1/admin/users',
          updateStatus: 'PATCH /api/v1/admin/users/:id/status',
          teachersList: 'GET /api/v1/admin/teachers',
          createTeacher: 'POST /api/v1/admin/teachers',
          getTeacher: 'GET /api/v1/admin/teachers/:id',
          updateTeacher: 'PATCH /api/v1/admin/teachers/:id',
          updateTeacherStatus: 'PATCH /api/v1/admin/teachers/:id/status',
          verifyTeacher: 'PATCH /api/v1/admin/teachers/:id/verify',
          appointmentsSummary: 'GET /api/v1/admin/appointments/summary',
          appointmentsList: 'GET /api/v1/admin/appointments',
          getAppointment: 'GET /api/v1/admin/appointments/:id',
          appointmentHistory: 'GET /api/v1/admin/appointments/:id/history',
          updateAppointmentMetadata: 'PATCH /api/v1/admin/appointments/:id',
          updateAppointmentStatus: 'PATCH /api/v1/admin/appointments/:id/status',
          rescheduleAppointment: 'POST /api/v1/admin/appointments/:id/reschedule',
          auditLogs: 'GET /api/v1/admin/audit-logs'
        },
        users: {
          profile: 'GET /api/v1/users/:id',
          update: 'PATCH /api/v1/users/:id'
        },
        teachers: {
          list: 'GET /api/v1/teachers',
          details: 'GET /api/v1/teachers/:id',
          update: 'PATCH /api/v1/teachers/:id'
        }
      }
    }
  });
});

module.exports = router;
