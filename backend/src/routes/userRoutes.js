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

module.exports = router;
