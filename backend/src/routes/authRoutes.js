/**
 * Authentication Routes (/api/v1/auth)
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validator');
const { loginRateLimiter } = require('../middlewares/rateLimiter');

// Login validation schema
const loginSchema = {
  email: {
    required: true,
    type: 'string',
    minLength: 5,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: 'Email address must be a valid format.'
  },
  password: {
    required: true,
    type: 'string',
    minLength: 1
  }
};

// Public Routes
router.post('/login', loginRateLimiter.middleware(), validate(loginSchema), authController.login);

// Logout endpoints (POST for API callers; GET for browser redirects)
router.post('/logout', authenticate, authController.logout);
router.get('/logout', (req, res, next) => {
  if (req.headers.authorization || req.headers.cookie) {
    return authenticate(req, res, () => authController.logout(req, res, next));
  }
  return authController.logout(req, res, next);
});

router.get('/me', authenticate, authController.me);
router.get('/verify', authenticate, authController.verify);

module.exports = router;
