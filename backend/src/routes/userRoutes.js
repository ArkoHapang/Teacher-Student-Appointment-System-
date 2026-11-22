/**
 * User & Private Records Routes (/api/v1/users)
 * Enforces ownership boundary: Users can only read/modify their own records;
 * Admins possess system-wide management authority.
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate } = require('../middlewares/authMiddleware');
const { authorizeOwnerOrAdmin } = require('../middlewares/rbacMiddleware');

// All user record routes require authentication
router.use(authenticate);

// Private record access: owner or admin only
router.get('/:id', authorizeOwnerOrAdmin('id'), userController.getProfile);
router.patch('/:id', authorizeOwnerOrAdmin('id'), userController.updateProfile);
router.get('/:id/notifications', authorizeOwnerOrAdmin('id'), userController.getNotifications);
router.patch('/:id/notifications/read-all', authorizeOwnerOrAdmin('id'), userController.markAllNotificationsAsRead);
router.post('/:id/notifications/mark-all-read', authorizeOwnerOrAdmin('id'), userController.markAllNotificationsAsRead);
router.patch('/:id/notifications/:notificationId/read', authorizeOwnerOrAdmin('id'), userController.markNotificationAsRead);
router.patch('/:id/notifications/:notificationId', authorizeOwnerOrAdmin('id'), userController.markNotificationAsRead);

module.exports = router;
