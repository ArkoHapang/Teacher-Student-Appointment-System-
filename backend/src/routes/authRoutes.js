/**
 * Authentication Routes (/api/v1/auth)
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validator');
const { loginRateLimiter, registrationRateLimiter } = require('../middlewares/rateLimiter');

// Student registration validation schema
const registerSchema = {
  email: {
    required: true,
    type: 'string',
    minLength: 5,
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: 'Email address must be a valid format.'
  },
  password: {
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 128
  },
  firstName: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 100
  },
  lastName: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 100
  },
  studentIdNumber: {
    required: true,
    type: 'string',
    minLength: 2,
    maxLength: 50
  },
  departmentId: {
    required: true
  }
};

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
router.post('/register', registrationRateLimiter.middleware(), validate(registerSchema), authController.register);
router.post('/login', loginRateLimiter.middleware(), validate(loginSchema), authController.login);

// Password recovery & Account Onboarding endpoints (Public)
router.post('/forgot-password', loginRateLimiter.middleware(), authController.forgotPassword);
router.post('/reset-password', loginRateLimiter.middleware(), authController.resetPassword);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', loginRateLimiter.middleware(), authController.resendVerification);
router.post('/onboard-teacher', loginRateLimiter.middleware(), authController.onboardTeacher);

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
