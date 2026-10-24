/**
 * Brute-Force & Rate Limiting Protection Middleware
 * Prevents credential stuffing and password brute-force attacks by limiting
 * failed login attempts per IP / identifier.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const logger = require('../config/logger');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.maxAttempts = options.maxAttempts || 5; // 5 failed attempts default
    this.hits = new Map(); // key -> { count, firstAttempt, blockedUntil }
  }

  /**
   * Resolve client identifier (combination of IP and targeted email if present).
   */
  resolveKey(req) {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const email = req.body && req.body.email ? req.body.email.trim().toLowerCase() : '';
    return email ? `${ip}:${email}` : ip;
  }

  /**
   * Check if a client key is currently blocked.
   */
  isBlocked(key) {
    const record = this.hits.get(key);
    if (!record) return false;

    const now = Date.now();
    if (record.blockedUntil && record.blockedUntil > now) {
      return true;
    }

    // Reset if window has elapsed
    if (now - record.firstAttempt > this.windowMs) {
      this.hits.delete(key);
      return false;
    }

    return false;
  }

  /**
   * Record a failed attempt. If threshold exceeded, lock key for window duration.
   */
  recordFailure(key) {
    const now = Date.now();
    let record = this.hits.get(key);

    if (!record || (now - record.firstAttempt > this.windowMs)) {
      record = { count: 1, firstAttempt: now, blockedUntil: null };
    } else {
      record.count += 1;
    }

    if (record.count >= this.maxAttempts) {
      record.blockedUntil = now + this.windowMs;
      logger.warn(`[RateLimiter] Key '${key}' exceeded ${this.maxAttempts} failed attempts. Blocked until ${new Date(record.blockedUntil).toISOString()}`);
    }

    this.hits.set(key, record);
    return record;
  }

  /**
   * Clear failed attempts upon successful authentication.
   */
  recordSuccess(key) {
    this.hits.delete(key);
  }

  /**
   * Reset all records (useful for automated test isolation).
   */
  reset() {
    this.hits.clear();
  }

  /**
   * Express middleware to block requests if currently locked out.
   */
  middleware() {
    return (req, res, next) => {
      const key = this.resolveKey(req);
      if (this.isBlocked(key)) {
        const record = this.hits.get(key);
        const retryAfterSeconds = Math.ceil((record.blockedUntil - Date.now()) / 1000);
        
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: `Too many failed login attempts. Please try again after ${retryAfterSeconds} seconds.`
          }
        });
      }
      next();
    };
  }
}

// Global instance for login route protection
const loginRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5
});

module.exports = {
  RateLimiter,
  loginRateLimiter
};
