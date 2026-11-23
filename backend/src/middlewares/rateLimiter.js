/**
 * Multi-Tier Brute-Force & Rate Limiting Protection Middleware
 *
 * Implements partitioned defensive controls with strict memory bounds:
 * 1. Target Account/IP Pair Protection: Prevents targeted credential stuffing.
 * 2. Source-Based Aggregate IP Spray Protection: Prevents distributed horizontal spraying across accounts.
 * 3. Account-Level Telemetry: Monitors targeted accounts without causing cross-IP DoS.
 * 4. Registration Abuse Protection: Independent email and campus-IP protection.
 *
 * Storage Architecture:
 * - Isolated Map instances for every protection dimension (pairHits, ipHits, accountHits / emailHits, ipHits).
 * - Strict capacity invariant: map.size <= maxEntries under all conditions.
 * - Active blocks are strictly immune to eviction.
 * - If capacity is reached and all entries are actively blocked, new key insertion is denied
 *   and middleware applies conservative fail-safe throttling (HTTP 429) to prevent fail-open bypass.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const logger = require('../config/logger');
const { resolveClientIp } = require('../utils/clientIpResolver');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_ACCOUNT_ATTEMPTS = 5; // 5 failed attempts per target account (pair)
const DEFAULT_MAX_IP_SPRAY_ATTEMPTS = 30; // 30 failed attempts per client IP
const DEFAULT_MAX_REGISTRATION_EMAIL_ATTEMPTS = 5; // 5 attempts per email address
const DEFAULT_MAX_REGISTRATION_IP_ATTEMPTS_PROD = 50; // 50 attempts per shared campus IP in production
const DEFAULT_MAX_REGISTRATION_IP_ATTEMPTS_TEST = 5; // 5 attempts in test mode
const DEFAULT_MAX_ENTRIES = 10000; // Hard memory cap per partition
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes periodic pruning

class BaseRateLimiter {
  constructor(options = {}) {
    this.name = options.name || 'BaseRateLimiter';
    this.windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.hits = new Map(); // key -> { count, firstAttempt, blockedUntil, meta }
    this.cleanupTimer = null;
    this.startCleanupTimer();
  }

  /**
   * Start periodic timer to evict expired records and prevent memory leaks.
   */
  startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Unref so the timer never keeps Node.js test runner processes open
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup timer (used for test teardown).
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Determine if a record is actively blocked.
   * @param {Object} record
   * @param {number} [now]
   * @returns {boolean}
   */
  isRecordBlocked(record, now = Date.now()) {
    return Boolean(record && record.blockedUntil && record.blockedUntil > now);
  }

  /**
   * Determine if a record is expired.
   * A record is expired if it is not currently blocked and its window has elapsed.
   * @param {Object} record
   * @param {number} [now]
   * @returns {boolean}
   */
  isRecordExpired(record, now = Date.now()) {
    if (!record) return true;
    if (this.isRecordBlocked(record, now)) return false;
    return (now - record.firstAttempt) > this.windowMs;
  }

  /**
   * Clean up expired records and enforce hard memory cap.
   * Active blocks are NEVER evicted.
   * If all entries in map are actively blocked, map size remains at current size
   * without evicting active blocks.
   */
  cleanup() {
    const now = Date.now();

    // 1. Evict expired records
    for (const [key, record] of this.hits.entries()) {
      if (this.isRecordExpired(record, now)) {
        this.hits.delete(key);
      }
    }

    // 2. Enforce capacity limit by evicting unblocked entries oldest-first
    if (this.hits.size > this.maxEntries) {
      for (const [key, record] of this.hits.entries()) {
        if (!this.isRecordBlocked(record, now)) {
          this.hits.delete(key);
          if (this.hits.size <= this.maxEntries) {
            break;
          }
        }
      }
    }

    if (this.hits.size > this.maxEntries) {
      logger.warn(`[RateLimiter:${this.name}] Active blocked entries (${this.hits.size}) exceed maxEntries (${this.maxEntries}). Active blocks preserved.`);
    }
  }

  /**
   * Check if a specific key is currently blocked.
   * @param {string} key
   * @returns {boolean}
   */
  isKeyBlocked(key) {
    if (!key) return false;
    const record = this.hits.get(key);
    if (!record) return false;

    const now = Date.now();
    if (this.isRecordBlocked(record, now)) {
      return true;
    }

    // Reset/delete entry if window has elapsed and not blocked
    if (this.isRecordExpired(record, now)) {
      this.hits.delete(key);
      return false;
    }

    return false;
  }

  /**
   * Return remaining block duration in seconds for a key, or 0 if unblocked.
   * @param {string} key
   * @returns {number}
   */
  getRemainingBlockSeconds(key) {
    if (!key) return 0;
    const record = this.hits.get(key);
    if (!record || !record.blockedUntil) return 0;
    const remainingMs = record.blockedUntil - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  /**
   * Check whether this map is completely exhausted:
   * i.e., at or above maxEntries AND every single entry is actively blocked,
   * meaning no new key can be inserted without exceeding capacity or evicting an active block.
   * @returns {boolean}
   */
  isCapacityExhausted() {
    if (this.hits.size < this.maxEntries) return false;

    const now = Date.now();
    // Check if any record is expired or unblocked
    for (const record of this.hits.values()) {
      if (this.isRecordExpired(record, now) || !this.isRecordBlocked(record, now)) {
        return false; // Can make room by evicting an unblocked/expired record
      }
    }
    return true; // Every record is actively blocked and map is at capacity
  }

  /**
   * Record a failure for a key with strict capacity bounds.
   *
   * Capacity Invariant:
   * this.hits.size <= this.maxEntries at all times.
   *
   * If map is at capacity and all entries are actively blocked:
   * - Does NOT evict any active block.
   * - Does NOT insert the new key.
   * - Returns { success: false, capacityExhausted: true, record: null }.
   *
   * @param {string} key
   * @param {number} maxAttempts
   * @param {Object} [meta={}]
   * @returns {{ success: boolean, capacityExhausted: boolean, record: Object|null }}
   */
  recordKeyFailure(key, maxAttempts, meta = {}) {
    if (!key) return { success: false, capacityExhausted: false, record: null };
    const now = Date.now();

    let record = this.hits.get(key);

    // If key does not exist yet in map
    if (!record) {
      // Inline capacity enforcement
      if (this.hits.size >= this.maxEntries) {
        this.cleanup();

        // If still at or above capacity, evict oldest unblocked entry
        if (this.hits.size >= this.maxEntries) {
          for (const [k, r] of this.hits.entries()) {
            if (!this.isRecordBlocked(r, now)) {
              this.hits.delete(k);
              if (this.hits.size < this.maxEntries) break;
            }
          }
        }

        // Strict invariant check: if STILL at capacity (meaning ALL entries are actively blocked)
        if (this.hits.size >= this.maxEntries) {
          logger.warn(`[RateLimiter:${this.name}] Capacity exhausted: all ${this.hits.size} entries are actively blocked. Denying new entry insertion.`);
          return { success: false, capacityExhausted: true, record: null };
        }
      }

      record = {
        count: 1,
        firstAttempt: now,
        blockedUntil: (1 >= maxAttempts ? now + this.windowMs : null),
        meta
      };
    } else {
      // Existing key: reset count if window elapsed and unblocked
      if (this.isRecordExpired(record, now)) {
        record.count = 1;
        record.firstAttempt = now;
        record.blockedUntil = (1 >= maxAttempts ? now + this.windowMs : null);
        record.meta = meta;
      } else {
        record.count += 1;
      }
    }

    if (record.count >= maxAttempts) {
      record.blockedUntil = now + this.windowMs;
      logger.warn(`[RateLimiter:${this.name}] Key '${key}' reached ${record.count}/${maxAttempts} attempts. Blocked until ${new Date(record.blockedUntil).toISOString()}`);
    }

    this.hits.set(key, record);
    return { success: true, capacityExhausted: false, record };
  }

  /**
   * Clear record for a key.
   * @param {string} key
   */
  clearKey(key) {
    if (key) this.hits.delete(key);
  }

  /**
   * Reset all records and stop timer.
   */
  reset() {
    this.hits.clear();
  }
}

/**
 * Login Rate Limiter
 * Layer 1: Per-(IP + target account) pair protection against targeted brute-force password guessing.
 *          Prevents unauthenticated attackers from causing Denial of Service against legitimate account owners.
 * Layer 2: Per-source-IP aggregate protection against horizontal password spraying across accounts.
 * Layer 3: Account-level failure tracking for telemetry and risk monitoring.
 *
 * Partitioned Storage:
 * - pairHits: Dedicated Map for IP+Account pairs (maxAttempts = 5)
 * - ipHits: Dedicated Map for aggregate IP tracking (maxAttempts = 30)
 * - accountHits: Dedicated Map for account telemetry (maxAttempts = 50)
 */
class LoginRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    this.maxPairAttempts = options.maxPairAttempts || options.maxAccountAttempts || DEFAULT_MAX_ACCOUNT_ATTEMPTS;
    this.maxAccountAttempts = options.maxAccountAttempts || DEFAULT_MAX_ACCOUNT_ATTEMPTS;
    this.maxIpAttempts = options.maxIpAttempts || DEFAULT_MAX_IP_SPRAY_ATTEMPTS;

    const baseCap = options.maxEntries || DEFAULT_MAX_ENTRIES;
    const pairCap = options.maxPairEntries || baseCap;
    const ipCap = options.maxIpEntries || baseCap;
    const accountCap = options.maxAccountEntries || baseCap;

    // Partition 1: Pair failures (IP + account)
    this.pairHits = new BaseRateLimiter({
      name: 'LoginPair',
      windowMs: this.windowMs,
      maxEntries: pairCap
    });

    // Partition 2: Aggregate source IP failures (independent of account)
    this.ipHits = new BaseRateLimiter({
      name: 'LoginIp',
      windowMs: this.windowMs,
      maxEntries: ipCap
    });

    // Partition 3: Account-level telemetry tracking
    this.accountHits = new BaseRateLimiter({
      name: 'LoginAccount',
      windowMs: this.windowMs,
      maxEntries: accountCap
    });

    this.maxEntries = pairCap;
  }

  // Backward compatibility getter for tests inspecting limiter.hits
  get hits() {
    return this.pairHits.hits;
  }

  normalizeEmail(email) {
    return email && typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  getPairKey(ip, email) {
    const normalized = this.normalizeEmail(email);
    const normalizedIp = ip ? String(ip).trim() : '127.0.0.1';
    return normalized ? `pair:${normalizedIp}:${normalized}` : null;
  }

  getAccountKey(email) {
    const normalized = this.normalizeEmail(email);
    return normalized ? `account:${normalized}` : null;
  }

  getIpKey(ip) {
    const normalizedIp = ip ? String(ip).trim() : '';
    return normalizedIp ? `ip:${normalizedIp}` : null;
  }

  isPairBlocked(ip, email) {
    const key = this.getPairKey(ip, email);
    return key ? this.pairHits.isKeyBlocked(key) : false;
  }

  isAccountBlocked(email) {
    const key = this.getAccountKey(email);
    return key ? this.accountHits.isKeyBlocked(key) : false;
  }

  isIpBlocked(ip) {
    const key = this.getIpKey(ip);
    return key ? this.ipHits.isKeyBlocked(key) : false;
  }

  isKeyBlocked(key) {
    if (!key) return false;
    if (key.startsWith('ip:')) return this.ipHits.isKeyBlocked(key);
    if (key.startsWith('account:')) return this.accountHits.isKeyBlocked(key);
    return this.pairHits.isKeyBlocked(key);
  }

  getRemainingBlockSeconds(key) {
    if (!key) return 0;
    if (key.startsWith('ip:')) return this.ipHits.getRemainingBlockSeconds(key);
    if (key.startsWith('account:')) return this.accountHits.getRemainingBlockSeconds(key);
    return this.pairHits.getRemainingBlockSeconds(key);
  }

  recordKeyFailure(key, maxAttempts, meta = {}) {
    if (!key) return { success: false, capacityExhausted: false, record: null };
    if (key.startsWith('ip:')) {
      const res = this.ipHits.recordKeyFailure(key, maxAttempts, meta);
      return res.record || res;
    }
    if (key.startsWith('account:')) {
      const res = this.accountHits.recordKeyFailure(key, maxAttempts, meta);
      return res.record || res;
    }
    const res = this.pairHits.recordKeyFailure(key, maxAttempts, meta);
    return res.record || res;
  }

  recordFailure(emailOrKey, ipAddress = null) {
    let email = '';
    let ip = ipAddress;

    // Backward compatibility: handle 'ip:email' format or distinct args
    if (typeof emailOrKey === 'string') {
      if (emailOrKey.includes(':') && !ip) {
        const parts = emailOrKey.split(':');
        ip = parts[0];
        email = parts.slice(1).join(':');
      } else {
        email = emailOrKey;
      }
    }

    const pairKey = this.getPairKey(ip, email);
    const ipKey = this.getIpKey(ip);
    const accountKey = this.getAccountKey(email);

    let pairRes = null;
    let ipRes = null;
    let accountRes = null;

    // 1. Record per-(IP+account) pair failure (locks this IP from attempting this account)
    if (pairKey) {
      pairRes = this.pairHits.recordKeyFailure(pairKey, this.maxPairAttempts, { type: 'pair', ip, email });
    }

    // 2. Record per-IP failure (isolated partition; locks source IP after cross-account spray threshold)
    if (ipKey) {
      ipRes = this.ipHits.recordKeyFailure(ipKey, this.maxIpAttempts, { type: 'ip_spray', ip });
    }

    // 3. Track account-level failure telemetry without blocking across other IPs
    if (accountKey) {
      accountRes = this.accountHits.recordKeyFailure(accountKey, this.maxPairAttempts * 10, { type: 'account', email });
    }

    return {
      pair: pairRes,
      ip: ipRes,
      account: accountRes
    };
  }

  recordSuccess(emailOrKey, ipAddress = null) {
    let email = '';
    let ip = ipAddress;
    if (typeof emailOrKey === 'string') {
      if (emailOrKey.includes(':') && !ip) {
        const parts = emailOrKey.split(':');
        ip = parts[0];
        email = parts.slice(1).join(':');
      } else {
        email = emailOrKey;
      }
    }

    const pairKey = this.getPairKey(ip, email);
    if (pairKey) {
      this.pairHits.clearKey(pairKey);
    }
    const accountKey = this.getAccountKey(email);
    if (accountKey) {
      this.accountHits.clearKey(accountKey);
    }
    // Intentionally do NOT clear ipKey so that IP spray accounting cannot be reset
    // by authenticating against a single account.
  }

  clearKey(key) {
    if (!key) return;
    if (key.startsWith('ip:')) this.ipHits.clearKey(key);
    else if (key.startsWith('account:')) this.accountHits.clearKey(key);
    else this.pairHits.clearKey(key);
  }

  reset() {
    this.pairHits.reset();
    this.ipHits.reset();
    this.accountHits.reset();
  }

  cleanup() {
    this.pairHits.cleanup();
    this.ipHits.cleanup();
    this.accountHits.cleanup();
  }

  stopCleanupTimer() {
    this.pairHits.stopCleanupTimer();
    this.ipHits.stopCleanupTimer();
    this.accountHits.stopCleanupTimer();
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.clientIp || resolveClientIp(req);
      const email = req.body && req.body.email ? req.body.email : '';

      // 1. Check IP-level spray lockout
      if (this.isIpBlocked(ip)) {
        const retryAfter = this.getRemainingBlockSeconds(this.getIpKey(ip));
        res.setHeader('Retry-After', retryAfter);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: `Too many failed login attempts from this network. Please try again after ${retryAfter} seconds.`
          }
        });
      }

      // 2. Check per-(IP+account) pair lockout
      if (email && this.isPairBlocked(ip, email)) {
        const retryAfter = this.getRemainingBlockSeconds(this.getPairKey(ip, email));
        res.setHeader('Retry-After', retryAfter);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: `Too many failed login attempts for this account from your IP address. Please try again after ${retryAfter} seconds.`
          }
        });
      }

      // 3. Conservative Capacity-Exhaustion Protection:
      // If either the IP or Pair partition is at full capacity with 100% actively blocked entries,
      // new unauthenticated requests cannot be safely tracked for brute-force defense.
      // To prevent fail-open authentication bypass under denial-of-inventory attacks,
      // conservatively throttle new untracked requests.
      const ipKey = this.getIpKey(ip);
      const pairKey = this.getPairKey(ip, email);

      const isNewIp = ipKey && !this.ipHits.hits.has(ipKey);
      const isNewPair = pairKey && !this.pairHits.hits.has(pairKey);

      if ((isNewIp && this.ipHits.isCapacityExhausted()) || (isNewPair && this.pairHits.isCapacityExhausted())) {
        res.setHeader('Retry-After', 60);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests on this service. Please try again after 60 seconds.'
          }
        });
      }

      next();
    };
  }
}

/**
 * Registration Rate Limiter
 * Layer 1: Per-email registration attempt limiter (prevents email bombardment).
 * Layer 2: Per-IP aggregate registration limiter (protects against high-volume bots while supporting campus networks).
 *
 * Partitioned Storage:
 * - emailHits: Dedicated Map for email registration attempts
 * - ipHits: Dedicated Map for aggregate IP registration attempts
 */
class RegistrationRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    this.maxEmailAttempts = options.maxEmailAttempts || DEFAULT_MAX_REGISTRATION_EMAIL_ATTEMPTS;

    const isTest = process.env.NODE_ENV === 'test';
    this.maxIpAttempts = options.maxAttempts || options.maxIpAttempts ||
      (isTest ? DEFAULT_MAX_REGISTRATION_IP_ATTEMPTS_TEST : DEFAULT_MAX_REGISTRATION_IP_ATTEMPTS_PROD);

    const baseCap = options.maxEntries || DEFAULT_MAX_ENTRIES;
    const emailCap = options.maxEmailEntries || baseCap;
    const ipCap = options.maxIpEntries || baseCap;

    this.emailHits = new BaseRateLimiter({
      name: 'RegEmail',
      windowMs: this.windowMs,
      maxEntries: emailCap
    });

    this.ipHits = new BaseRateLimiter({
      name: 'RegIp',
      windowMs: this.windowMs,
      maxEntries: ipCap
    });

    this.maxEntries = emailCap;
  }

  get hits() {
    return this.emailHits.hits;
  }

  normalizeEmail(email) {
    return email && typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  getEmailKey(email) {
    const normalized = this.normalizeEmail(email);
    return normalized ? `reg_email:${normalized}` : null;
  }

  getIpKey(ip) {
    return ip ? `reg_ip:${ip}` : null;
  }

  isEmailBlocked(email) {
    const key = this.getEmailKey(email);
    return key ? this.emailHits.isKeyBlocked(key) : false;
  }

  isIpBlocked(ip) {
    const key = this.getIpKey(ip);
    return key ? this.ipHits.isKeyBlocked(key) : false;
  }

  getRemainingBlockSeconds(key) {
    if (!key) return 0;
    if (key.startsWith('reg_ip:')) return this.ipHits.getRemainingBlockSeconds(key);
    return this.emailHits.getRemainingBlockSeconds(key);
  }

  recordKeyFailure(key, maxAttempts, meta = {}) {
    if (!key) return { success: false, capacityExhausted: false, record: null };
    if (key.startsWith('reg_ip:')) {
      const res = this.ipHits.recordKeyFailure(key, maxAttempts, meta);
      return res.record || res;
    }
    const res = this.emailHits.recordKeyFailure(key, maxAttempts, meta);
    return res.record || res;
  }

  recordAttempt(email, ip) {
    const emailKey = this.getEmailKey(email);
    const ipKey = this.getIpKey(ip);

    let emailRes = null;
    let ipRes = null;

    if (emailKey) {
      emailRes = this.emailHits.recordKeyFailure(emailKey, this.maxEmailAttempts, { type: 'reg_email', email });
    }
    if (ipKey) {
      ipRes = this.ipHits.recordKeyFailure(ipKey, this.maxIpAttempts, { type: 'reg_ip', ip });
    }

    return { email: emailRes, ip: ipRes };
  }

  reset() {
    this.emailHits.reset();
    this.ipHits.reset();
  }

  cleanup() {
    this.emailHits.cleanup();
    this.ipHits.cleanup();
  }

  stopCleanupTimer() {
    this.emailHits.stopCleanupTimer();
    this.ipHits.stopCleanupTimer();
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.clientIp || resolveClientIp(req);
      const email = req.body && req.body.email ? req.body.email : '';

      // 1. Check IP-level registration lockout
      if (this.isIpBlocked(ip)) {
        const retryAfter = this.getRemainingBlockSeconds(this.getIpKey(ip));
        res.setHeader('Retry-After', retryAfter);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many registration attempts from this IP address. Please try again after ${retryAfter} seconds.`
          }
        });
      }

      // 2. Check per-email registration lockout
      if (email && this.isEmailBlocked(email)) {
        const retryAfter = this.getRemainingBlockSeconds(this.getEmailKey(email));
        res.setHeader('Retry-After', retryAfter);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many registration attempts for this email address. Please try again after ${retryAfter} seconds.`
          }
        });
      }

      // 3. Conservative Capacity-Exhaustion Protection
      const emailKey = this.getEmailKey(email);
      const ipKey = this.getIpKey(ip);
      const isNewEmail = emailKey && !this.emailHits.hits.has(emailKey);
      const isNewIp = ipKey && !this.ipHits.hits.has(ipKey);

      if ((isNewEmail && this.emailHits.isCapacityExhausted()) || (isNewIp && this.ipHits.isCapacityExhausted())) {
        res.setHeader('Retry-After', 60);
        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many registration requests on this service. Please try again after 60 seconds.'
          }
        });
      }

      // Record attempt on both dimensions
      this.recordAttempt(email, ip);
      next();
    };
  }
}

// Global production instances
const loginRateLimiter = new LoginRateLimiter();
const registrationRateLimiter = new RegistrationRateLimiter();

module.exports = {
  BaseRateLimiter,
  RateLimiter: LoginRateLimiter, // Backward compatibility alias
  LoginRateLimiter,
  RegistrationRateLimiter,
  loginRateLimiter,
  registrationRateLimiter
};
