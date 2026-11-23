/**
 * Notification Routes
 *
 * Mounts endpoints for real-time notification streaming and management.
 * Protected by authentication middleware.
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/authMiddleware');

// GET /api/v1/notifications/stream - Authenticated real-time SSE stream
router.get('/stream', authenticate, notificationController.stream);

module.exports = router;
